import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import type definition from './_def_.ts';

const fitModes = { stretch: 0, cover: 1, contain: 2 };
const layouts = { blocks: 0, horizontalBands: 1, verticalBands: 2 };

export default implementEffect<typeof definition>({
	// 入力が静止していても、実時刻に対する履歴の古さと保存位置は更新する。
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enable32bitDataTextures }, resolution }) => {
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const historyLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const output = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code,
			schema: { input: 'color', density: 'vector' },
			internalLayouts: [historyLayout], sampling: 'level0',
			targets: [{ format: intermediateTextureFormat }],
		});
		// 保存時には同じtexture arrayを読み取りbindingへ含めず、書き込みとの重複を避ける。
		const emptyLayout = device.createBindGroupLayout({ entries: [] });
		const emptyGroup = device.createBindGroup({ layout: emptyLayout, entries: [] });
		const capture = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: captureCode,
			schema: { input: 'color' }, internalLayouts: [emptyLayout],
			entryPoint: 'capture', targets: [{ format: historyFormat }],
		});
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		const createHistory = (width: number, height: number, layers: number) => {
			const texture = device.createTexture({
				size: { width, height, depthOrArrayLayers: layers }, format: historyFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
			});
			try {
				const views = Array.from({ length: layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }));
				const group = device.createBindGroup({ layout: historyLayout, entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } },
					{ binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
					{ binding: 2, resource: sampler },
				] });
				return { texture, views, group, times: new Float64Array(layers), width, height, layers };
			} catch (error) {
				texture.destroy();
				throw error;
			}
		};
		let history: ReturnType<typeof createHistory> | null = null;
		let frameCount = 0;
		let newestLayer = 0;
		let lastCaptureTime: number | null = null;
		let lastRenderTime: number | null = null;
		let previousInputSettings: string | null = null;
		const ages = new Float32Array(64);
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		const clearHistory = () => {
			// 無効なスロットはframeCountで除外するため、GPU上の全画像をクリアする必要はない。
			frameCount = 0;
			newestLayer = 0;
			lastCaptureTime = null;
		};

		return {
			render: ctx => {
				const params = ctx.params;
				if (![params.historyFrames, params.historyScale, params.maxDelay, params.patternRate, ctx.time].every(Number.isFinite)) {
					throw new Error('Region time shift: history settings and time must be finite numbers.');
				}
				const layers = Math.min(64, device.limits.maxTextureArrayLayers, Math.max(2, Math.round(params.historyFrames)));
				const scale = Math.min(1, Math.max(0.01, params.historyScale / 100));
				const width = Math.max(1, Math.round(resolution.width * scale));
				const height = Math.max(1, Math.round(resolution.height * scale));
				if (history == null || history.width !== width || history.height !== height || history.layers !== layers) {
					const next = createHistory(width, height, layers);
					history?.texture.destroy();
					history = next;
					clearHistory();
				}
				const input = params.input;
				const inputSettings = input.kind === 'texture'
					? `${input.kind}:${input.texture.width}:${input.texture.height}:${input.fitMode}:${input.wrapMode}:${input.filterMode}`
					: input.kind;
				const time = ctx.time * 1000;
				const elapsed = lastRenderTime == null ? 0 : time - lastRenderTime;
				const maxDelay = Math.max(0, params.maxDelay);
				const captureInterval = maxDelay / (layers - 1);
				// 明示的なシークでは時刻差とtimeDeltaが一致しない。逆再生や長い中断でも履歴を切り、
				// 異なる再生区間の画像が混ざることを避ける。短い遅延を指定しても通常の描画間隔で
				// リセットしないよう、中断の判定には少なくとも1秒の猶予を設ける。
				const discontinuity = elapsed < -0.001 || (elapsed > 0.001 && (
					!Number.isFinite(ctx.timeDelta) || ctx.timeDelta <= 0
					|| Math.abs(elapsed - ctx.timeDelta) > Math.max(1, Math.abs(elapsed) * 0.001)
					|| elapsed > Math.max(1000, maxDelay + captureInterval)
				));
				if (params.reset || discontinuity || inputSettings !== previousInputSettings) clearHistory();
				previousInputSettings = inputSettings;
				const sameTime = lastRenderTime != null && Math.abs(elapsed) <= 0.001;
				if (lastCaptureTime == null || sameTime || time - lastCaptureTime >= captureInterval - 0.001) {
					// 停止中の再描画では同じ時刻のスロットを上書きする。再描画回数だけで
					// リングを進めると、パラメータ編集で過去のフレームを失ってしまう。
					if (frameCount > 0 && lastCaptureTime != null && time - lastCaptureTime > 0.001) {
						newestLayer = (newestLayer + 1) % layers;
					}
					const variant = capture.update({ input }, ctx.outputDataMap.output.texture);
					const save = ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [{ view: history.views[newestLayer], clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
					});
					save.setPipeline(variant.pipeline);
					save.setBindGroup(0, emptyGroup);
					save.setBindGroup(capture.inputGroup, variant.bindGroup);
					save.draw(6);
					save.end();
					if (frameCount === 0 || lastCaptureTime == null || time - lastCaptureTime > 0.001) frameCount = Math.min(layers, frameCount + 1);
					history.times[newestLayer] = time;
					lastCaptureTime = time;
				}
				// フレーム番号ではなく各保存画像の実時刻を渡す。保存できない中間フレームを
				// 現在の画像で埋めず、存在する画像の中から要求した遅延に近いものを選ぶ。
				ages.fill(0);
				for (let i = 0; i < frameCount; i++) {
					const layer = (newestLayer + layers - i) % layers;
					ages[layer] = Math.max(0, (time - history.times[layer]) / 1000);
				}
				seedValue[0] = params.seed;
				uniformValues.set({
					resolution: [resolution.width, resolution.height],
					amount: Math.min(1, Math.max(0, params.amount)),
					maxDelay: maxDelay / 1000,
					fitMode: fitModes[params.fitMode],
					regionLayout: layouts[params.layout],
					newestLayer,
					layerCount: layers,
					frameCount,
					interpolate: Number(params.interpolate),
					channelSplit: Number(params.channelSplit),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					phase: Math.floor(ctx.time * Math.max(0, params.patternRate)) >>> 0,
					historyAges: ages,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = output.update({ input, density: params.density }, ctx.outputDataMap.output.texture);
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				render.setPipeline(variant.pipeline);
				render.setBindGroup(0, history.group);
				render.setBindGroup(output.inputGroup, variant.bindGroup);
				render.draw(6);
				render.end();
				lastRenderTime = time;
			},
			dispose: () => {
				history?.texture.destroy();
				capture.dispose();
				output.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
