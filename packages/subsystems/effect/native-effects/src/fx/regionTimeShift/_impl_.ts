import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createFixedInputPipeline, bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import captureCode from './capture.wgsl?raw';
import type definition from './_def_.ts';

const layouts = { blocks: 0, horizontalBands: 1, verticalBands: 2 };

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const historyLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			],
		});
		const output = createFixedInputPipeline(params, resolution, {
			device,
			vertex: defaultVertexShaderModule,
			code,
			schema: { input: 'color', density: 'vector' },
			internalLayouts: [historyLayout],
			sampling: 'level0',
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		// 保存時には同じtexture arrayを読み取りbindingへ含めず、書き込みとの重複を避ける。
		const emptyLayout = device.createBindGroupLayout({ entries: [] });
		const emptyGroup = device.createBindGroup({ layout: emptyLayout, entries: [] });
		const capture = createFixedInputPipeline(params, resolution, {
			device,
			vertex: defaultVertexShaderModule,
			code: captureCode,
			schema: { input: 'color' },
			internalLayouts: [emptyLayout],
			entryPoint: 'capture',
			targets: [{ format: historyFormat }],
		});
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const sampler = device.createSampler({
			minFilter: 'linear',
			magFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
		const createHistory = (width: number, height: number, layers: number) => {
			const texture = device.createTexture({
				size: { width, height, depthOrArrayLayers: layers },
				format: historyFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
			});
			try {
				const views = Array.from({ length: layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }));
				const group = device.createBindGroup({
					layout: historyLayout,
					entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						{ binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
						{ binding: 2, resource: sampler },
					],
				});
				return {
					texture,
					views,
					group,
					times: new Float64Array(layers),
					width,
					height,
					layers,
				};
			} catch (error) {
				texture.destroy();
				throw error;
			}
		};
		let history: ReturnType<typeof createHistory> | null = null;
		let frameCount = 0;
		let newestLayer = 0;
		let lastCaptureTime: number | null = null;
		let nextCaptureTime: number | null = null;
		let previousCaptureInterval: number | null = null;
		let lastRenderTime: number | null = null;
		const ages = new Float32Array(64);
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		const clearHistory = () => {
			// 無効なスロットはframeCountで除外するため、GPU上の全画像をクリアする必要はない。
			frameCount = 0;
			newestLayer = 0;
			lastCaptureTime = null;
			nextCaptureTime = null;
			previousCaptureInterval = null;
		};

		return {
			resetRenderHistory() {
				clearHistory();
				lastRenderTime = null;
			},
			render: ctx => {
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
				if (params.reset || discontinuity) clearHistory();
				if (captureInterval !== previousCaptureInterval) {
					nextCaptureTime = lastCaptureTime == null ? time : lastCaptureTime + captureInterval;
					previousCaptureInterval = captureInterval;
				}
				// 時計の丸めを最大0.5ms許容する。短い保存間隔でも先取りは半周期までとする。
				const captureTolerance = Math.min(0.5, captureInterval / 2);
				const captureDue = captureInterval === 0 || nextCaptureTime == null || time + captureTolerance >= nextCaptureTime;
				const sameTime = lastRenderTime != null && Math.abs(elapsed) <= 0.001;
				if (sameTime || captureDue) {
					// 停止中の再描画では同じ時刻のスロットを上書きする。再描画回数だけで
					// リングを進めると、パラメータ編集で過去のフレームを失ってしまう。
					if (frameCount > 0 && lastCaptureTime != null && time - lastCaptureTime > 0.001) {
						newestLayer = (newestLayer + 1) % layers;
					}
					const save = ctx.commandEncoder.beginRenderPass({
						colorAttachments: [{
							view: history.views[newestLayer],
							clearValue: [0, 0, 0, 0],
							loadOp: 'clear',
							storeOp: 'store',
						}],
					});
					save.setPipeline(capture.pipeline);
					save.setBindGroup(0, emptyGroup);
					save.setBindGroup(capture.inputGroup, capture.getBindGroup());
					save.draw(3);
					save.end();
					if (frameCount === 0 || lastCaptureTime == null || time - lastCaptureTime > 0.001) frameCount = Math.min(layers, frameCount + 1);
					history.times[newestLayer] = time;
					lastCaptureTime = time;
					if (captureDue) {
						// 描画待ちの端数を累積させず、元の保存周期を維持する。判定と同じ猶予を
						// 予定の更新にも使い、停止中の上書きだけでは次の予定を先送りしない。
						const deadline = nextCaptureTime ?? time;
						nextCaptureTime = captureInterval > 0
							? deadline + (Math.floor((time + captureTolerance - deadline) / captureInterval) + 1) * captureInterval
							: time;
					}
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
					referenceLength: getSizeReferenceLength(params.sizeReference, resolution),
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
				const render = beginOutputPass(ctx.commandEncoder, outputView);
				render.setPipeline(output.pipeline);
				render.setBindGroup(0, history.group);
				render.setBindGroup(output.inputGroup, output.getBindGroup());
				render.draw(3);
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
};

export default implementation;
