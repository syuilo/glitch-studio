import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createFixedInputPipeline, bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import uniformCode, { uniforms as uniformCodeUniforms } from './history-uniforms.wgsl?shader';
import captureCode from './capture-input.wgsl?raw';
import sortCode from './sort-history.wgsl?raw';
import type definition from './_def_.ts';

const MAX_HISTORY_FRAMES = 64;
const sortKeys = { luminance: 0, red: 1, green: 2, blue: 3, alpha: 4, saturation: 5 };
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const uniformValues = createShaderBuffer(uniformCodeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const historyLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const historySampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		// 保存するpassには履歴arrayを読み取りbindingとして渡さず、書き込みとの重複を避ける。
		const capture = createFixedInputPipeline(params, resolution, {
			device, vertex: defaultVertexShaderModule, code: captureCode,
			schema: { input: 'color' }, targets: [{ format: historyFormat }],
			sampling: 'level0', entryPoint: 'capture_input',
		});
		const output = createFixedInputPipeline(params, resolution, {
			device, vertex: defaultVertexShaderModule,
			code: `const SORT_CAPACITY: u32 = ${MAX_HISTORY_FRAMES}u;\n` + uniformCode + '\n' + sortCode,
			schema: { input: 'color', rank: 'scalar', amount: 'scalar' },
			internalLayouts: [historyLayout], targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			sampling: 'level0', entryPoint: 'sort_history',
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

				return {
					width, height, layers, layerViews, bindGroup,
					captureTimes: new Float64Array(layers),
					dispose: () => {
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
			resetRenderHistory: clearHistory,
			render: ctx => {
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
				// 時計の丸めで境界直前になっても保存する。猶予は最大0.5ms、半周期までとする。
				const captureTolerance = Math.min(0.0005, captureInterval / 2);
				const shouldCapture = capturedFrameCount === 0 || (seconds > 0
					&& (captureInterval === 0 || nextCaptureTime == null || elapsedSeconds + captureTolerance >= nextCaptureTime));
				if (shouldCapture) {
					const advance = capturedFrameCount > 0 && lastCaptureTime != null && elapsedSeconds - lastCaptureTime > 0.000001;
					if (advance) newestLayer = (newestLayer + 1) % layers;
					if (capturedFrameCount === 0 || advance) capturedFrameCount = Math.min(layers, capturedFrameCount + 1);
					const save = ctx.commandEncoder.beginRenderPass({
						colorAttachments: [{ view: history.layerViews[newestLayer], clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
					});
					save.setPipeline(capture.pipeline);
					save.setBindGroup(capture.inputGroup, capture.getBindGroup());
					save.draw(3);
					save.end();
					history.captureTimes[newestLayer] = elapsedSeconds;
					lastCaptureTime = elapsedSeconds;
					if (captureInterval > 0) {
						// 保存時刻を次の締切の基準にすると、描画間隔への切り上げが毎回累積する。
						// 元の採取間隔を維持して次の締切へ進め、描画されなかった時刻は埋めない。
						// 判定と同じ猶予を含め、境界直前に採取した周期を次の描画で二重に採取しない。
						const deadline = nextCaptureTime ?? elapsedSeconds;
						const intervalsPassed = Math.max(1, Math.floor((elapsedSeconds + captureTolerance - deadline) / captureInterval) + 1);
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
				const sorted = output;
				const render = beginOutputPass(ctx.commandEncoder, outputView);
				render.setPipeline(sorted.pipeline);
				render.setBindGroup(0, history.bindGroup);
				render.setBindGroup(output.inputGroup, sorted.getBindGroup());
				render.draw(3);
				render.end();
			},
			dispose: () => {
				history?.dispose();
				capture.dispose();
				output.dispose();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
