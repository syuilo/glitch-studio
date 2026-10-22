import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import uniformCode from './history-uniforms.wgsl?raw';
import captureCode from './capture-input.wgsl?raw';
import sortCode from './sort-history.wgsl?raw';
import type definition from './_def_.ts';

const MAX_HISTORY_FRAMES = 64;
const sortKeys = { luminance: 0, red: 1, green: 2, blue: 3, alpha: 4, saturation: 5 };
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export default implementEffect<typeof definition>({
	// 同じ入力が続いても保存範囲が更新されるため、通常の入力キャッシュでは省略しない。
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
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(uniformCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const historyLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const historySampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		// 保存するpassには履歴arrayを読み取りbindingとして渡さず、書き込みとの重複を避ける。
		const capture = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: captureCode,
			schema: { input: 'color' }, targets: [{ format: historyFormat }],
			sampling: 'level0', entryPoint: 'capture_input',
		});
		const createHistoryResources = (width: number, height: number, layers: number) => {
			const texture = device.createTexture({
				size: { width, height, depthOrArrayLayers: layers }, format: historyFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
			});
			try {
				const layerViews = Array.from({ length: layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }));
				const bindGroup = device.createBindGroup({
					layout: historyLayout,
					entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						{ binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
						{ binding: 2, resource: historySampler },
					],
				});
				const sortCapacity = 2 ** Math.ceil(Math.log2(layers));
				const output = createShaderInputPipeline({
					device, vertex: defaultVertexShaderModule,
					// ローカル配列は実際の保存枚数に合わせた定数で確保する。現在の入力も1候補とし、
					// 保存画像は最大layers-1枚だけ参照するので、全候補がこの容量へ収まる。
					code: `const SORT_CAPACITY: u32 = ${sortCapacity}u;\n` + uniformCode + '\n' + sortCode,
					schema: { input: 'color', rank: 'scalar', amount: 'scalar' },
					internalLayouts: [historyLayout], targets: [{ format: intermediateTextureFormat }],
					sampling: 'level0', entryPoint: 'sort_history',
				});
				return {
					width, height, layers, layerViews, bindGroup, output,
					captureTimes: new Float64Array(layers),
					dispose: () => {
						output.dispose();
						texture.destroy();
					},
				};
			} catch (error) {
				texture.destroy();
				throw error;
			}
		};
		let history: ReturnType<typeof createHistoryResources> | null = null;
		let capturedFrameCount = 0;
		let newestLayer = 0;
		let elapsedSeconds = 0;
		let lastCaptureTime: number | null = null;
		let nextCaptureTime: number | null = null;
		let previousCaptureInterval: number | null = null;
		const candidateLayers = new Uint32Array(MAX_HISTORY_FRAMES);
		const clearHistory = () => {
			// 候補数で無効な保存先を除外するため、全レイヤーのGPUクリアは不要。
			capturedFrameCount = 0;
			newestLayer = 0;
			elapsedSeconds = 0;
			lastCaptureTime = null;
			nextCaptureTime = null;
			previousCaptureInterval = null;
		};

		return {
			render: ctx => {
				const params = ctx.params;
				if (![params.historyFrames, params.historyDuration, params.historyScale].every(Number.isFinite)) {
					throw new Error('Temporal Pixel Sort: history settings must be finite numbers.');
				}
				const layers = clamp(Math.round(params.historyFrames), 2, Math.min(MAX_HISTORY_FRAMES, device.limits.maxTextureArrayLayers));
				const historyScale = clamp(params.historyScale / 100, 0.01, 1);
				const width = Math.max(1, Math.round(resolution.width * historyScale));
				const height = Math.max(1, Math.round(resolution.height * historyScale));
				if (history == null || history.width !== width || history.height !== height || history.layers !== layers) {
					const next = createHistoryResources(width, height, layers);
					history?.dispose();
					history = next;
					clearHistory();
				}
				if (params.reset) clearHistory();
				const seconds = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				// 描画した順序と経過時間を記録する。シーク先から履歴を再構築する処理は行わない。
				elapsedSeconds += seconds;
				const historyDuration = Math.max(0, params.historyDuration) / 1000;
				const captureInterval = historyDuration / (layers - 1);
				if (captureInterval !== previousCaptureInterval) {
					nextCaptureTime = lastCaptureTime == null ? elapsedSeconds : lastCaptureTime + captureInterval;
					previousCaptureInterval = captureInterval;
				}
				const shouldCapture = capturedFrameCount === 0 || (seconds > 0
					&& (captureInterval === 0 || nextCaptureTime == null || elapsedSeconds + 0.000001 >= nextCaptureTime));
				if (shouldCapture) {
					const advance = capturedFrameCount > 0 && lastCaptureTime != null && elapsedSeconds - lastCaptureTime > 0.000001;
					if (advance) newestLayer = (newestLayer + 1) % layers;
					if (capturedFrameCount === 0 || advance) capturedFrameCount = Math.min(layers, capturedFrameCount + 1);
					const captured = capture.update({ input: params.input }, ctx.outputDataMap.output.texture);
					const save = ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [{ view: history.layerViews[newestLayer], clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
					});
					save.setPipeline(captured.pipeline);
					save.setBindGroup(capture.inputGroup, captured.bindGroup);
					save.draw(6);
					save.end();
					history.captureTimes[newestLayer] = elapsedSeconds;
					lastCaptureTime = elapsedSeconds;
					if (captureInterval > 0) {
						// 保存時刻を次の締切の基準にすると、描画間隔への切り上げが毎回累積する。
						// 元の採取間隔を維持して次の締切へ進め、描画されなかった時刻は埋めない。
						const deadline = nextCaptureTime ?? elapsedSeconds;
						const intervalsPassed = Math.max(1, Math.floor((elapsedSeconds - deadline) / captureInterval) + 1);
						nextCaptureTime = deadline + intervalsPassed * captureInterval;
					} else {
						nextCaptureTime = elapsedSeconds;
					}
				}

				let historyCount = 0;
				candidateLayers.fill(0);
				for (let historyIndex = 0; historyIndex < capturedFrameCount && historyCount < layers - 1; historyIndex++) {
					const layer = (newestLayer + layers - historyIndex) % layers;
					const age = elapsedSeconds - history.captureTimes[layer];
					// 現在の入力を必ず1候補に含める。同時刻の保存画像まで含めると、その色だけが
					// 重複して順位に影響するため除外する。停止中の再描画でも履歴は押し流さない。
					if (age <= 0.000001) continue;
					if (age > historyDuration + 0.000001) break;
					candidateLayers[historyCount] = layer;
					historyCount++;
				}
				uniformValues.set({
					historyCount,
					sortKey: sortKeys[params.sortBy],
					descending: Number(params.order === 'descending'),
					interpolateRanks: Number(params.interpolateRanks),
					ignoreTransparent: Number(params.ignoreTransparent),
					historyLayers: candidateLayers,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// fit/wrapは保存画像の寸法ではなく、実際の出力サイズを基準に生成する。
				const sorted = history.output.update({ input: params.input, rank: params.rank, amount: params.amount }, ctx.outputDataMap.output.texture);
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				render.setPipeline(sorted.pipeline);
				render.setBindGroup(0, history.bindGroup);
				render.setBindGroup(history.output.inputGroup, sorted.bindGroup);
				render.draw(6);
				render.end();
			},
			dispose: () => {
				history?.dispose();
				capture.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
