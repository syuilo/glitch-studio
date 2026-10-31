import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import updateBlocksCode from './update-blocks.wgsl?raw';
import composeCode from './compose.wgsl?raw';
import type definition from './_def_.ts';

const motionModes = { off: 0, movingOlder: 1, movingNewer: 2 };
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export default implementEffect<typeof definition>({
	// 入力が変わらなくても履歴の経過時間と停止状態が変わるため、入力のキャッシュで省略しない。
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
		const analysisFormat = enable32bitDataTextures ? 'rg32float' : 'rg16float';
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const uniformLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [uniformEntry] });
		const blockLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		const composeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		const createCapturePipeline = (entryPoint: string, format: GPUTextureFormat) => createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + captureCode,
			schema: { input: 'color' }, internalLayouts: [uniformLayout],
			sampling: 'level0', entryPoint, targets: [{ format }],
		});
		// 保存用pipelineのbindingには履歴arrayを含めず、同じリソースへの読み書きの重複を避ける。
		const captureHistory = createCapturePipeline('capture_history', historyFormat);
		const captureAnalysis = createCapturePipeline('capture_analysis', analysisFormat);
		const updateBlocks = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + updateBlocksCode,
			schema: { delayMap: 'scalar' }, internalLayouts: [blockLayout],
			sampling: 'level0', entryPoint: 'update_blocks', targets: [{ format: historyFormat }],
		});
		const compose = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + composeCode,
			schema: { input: 'color' }, internalLayouts: [composeLayout],
			sampling: 'level0', entryPoint: 'compose',
			targets: [{ format: intermediateTextureFormat }, { format: historyFormat }],
		});
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		const createTexture = (size: { width: number; height: number }, format: GPUTextureFormat) => device.createTexture({
			size, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const analysisScale = 256 / Math.max(resolution.width, resolution.height);
		const analysisSize = {
			width: Math.max(1, Math.round(resolution.width * analysisScale)),
			height: Math.max(1, Math.round(resolution.height * analysisScale)),
		};
		const analysisTextures = [createTexture(analysisSize, analysisFormat), createTexture(analysisSize, analysisFormat)];
		const analysisViews = analysisTextures.map(texture => texture.createView());
		// 停止画像はリングと分離し、出力の原寸で保持する。履歴の上書きやAmountの変更で
		// 停止中のブロックが別の時刻へ入れ替わることを防ぐ。
		const patchworkTextures = [createTexture(resolution, historyFormat), createTexture(resolution, historyFormat)];
		const patchworkViews = patchworkTextures.map(texture => texture.createView());
		const createHistory = (width: number, height: number, layers: number) => {
			const texture = device.createTexture({
				size: { width, height, depthOrArrayLayers: layers }, format: historyFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
			});
			try {
				return {
					texture, width, height, layers,
					view: texture.createView({ dimension: '2d-array' }),
					layerViews: Array.from({ length: layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })),
					times: new Float64Array(layers),
				};
			} catch (error) {
				texture.destroy();
				throw error;
			}
		};
		const getBlockGeometry = (blockSize: number, referenceLength: number, centered: boolean) => {
			if (!Number.isFinite(blockSize) || blockSize <= 0) throw new Error('Time Patchwork: block size must be a positive finite number.');
			const block = [blockSize / 100 * referenceLength / resolution.width, blockSize / 100 * referenceLength / resolution.height];
			// 中央モードでは奇数個を使い、ブロック数が変わっても中央ブロックの中心を固定する。
			const countBlocks = (axisBlockSize: number) => centered
				? Math.max(1, Math.ceil(0.5 / axisBlockSize - 0.5) * 2 + 1)
				: Math.max(1, Math.ceil(1 / axisBlockSize));
			const width = countBlocks(block[0]);
			const height = countBlocks(block[1]);
			if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
				|| width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D) {
				throw new Error('Time Patchwork: block grid exceeds GPU texture limits. Increase Block Size.');
			}
			return { width, height, block, origin: centered ? [0.5 - width * block[0] * 0.5, 0.5 - height * block[1] * 0.5] : [0, 0] };
		};
		const createBlockResources = (size: { width: number; height: number }) => {
			const textures: GPUTexture[] = [];
			try {
				textures.push(createTexture(size, historyFormat));
				textures.push(createTexture(size, historyFormat));
				const views = textures.map(texture => texture.createView());
				const updateGroups = views.map((_, index) => device.createBindGroup({
					layout: blockLayout,
					entries: [uniformEntry,
						{ binding: 1, resource: sampler },
						{ binding: 2, resource: analysisViews[1 - index] },
						{ binding: 3, resource: analysisViews[index] },
						{ binding: 4, resource: views[1 - index] },
					],
				}));
				// 履歴arrayの再確保後は新しいviewでbindingを作る。旧viewを保持し続けない。
				const composeGroups = new WeakMap<GPUTextureView, GPUBindGroup[]>();
				return {
					width: size.width, height: size.height, views, updateGroups,
					composeGroup: (index: number, historyView: GPUTextureView) => {
						let groups = composeGroups.get(historyView);
						if (groups == null) {
							groups = views.map((view, currentIndex) => device.createBindGroup({
								layout: composeLayout,
								entries: [uniformEntry,
									{ binding: 1, resource: historyView },
									{ binding: 2, resource: sampler },
									{ binding: 3, resource: view },
									{ binding: 4, resource: patchworkViews[1 - currentIndex] },
								],
							}));
							composeGroups.set(historyView, groups);
						}
						return groups[index];
					},
					dispose: () => { for (const texture of textures) texture.destroy(); },
				};
			} catch (error) {
				for (const texture of textures) texture.destroy();
				throw error;
			}
		};
		let history: ReturnType<typeof createHistory> | null = null;
		let blockResources: ReturnType<typeof createBlockResources> | null = null;
		let historyFrameCount = 0;
		let newestLayer = 0;
		let lastCaptureTime: number | null = null;
		let elapsedSeconds = 0;
		let frameIndex = 0;
		let currentIndex = 0;
		let hasAnalysis = false;
		let hasBlockState = false;
		let previousGridSettings: string | null = null;
		let previousInputSettings: string | null = null;
		const historyAges = new Float32Array(64);
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		const clearHistory = () => {
			// 無効な保存先はframeCount、停止状態はresetBlocksで除外し、全画像のクリアは省く。
			historyFrameCount = 0;
			newestLayer = 0;
			lastCaptureTime = null;
			elapsedSeconds = 0;
			frameIndex = 0;
			currentIndex = 0;
			hasAnalysis = false;
			hasBlockState = false;
		};
		const attachment = (view: GPUTextureView): GPURenderPassColorAttachment => ({
			view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store',
		});

		return {
			render: ctx => {
				const params = ctx.params;
				if (![params.historyFrames, params.historyScale, params.maxDelay, params.patternRate].every(Number.isFinite)) {
					throw new Error('Time Patchwork: history settings must be finite numbers.');
				}
				const layers = clamp(Math.round(params.historyFrames), 2, Math.min(64, device.limits.maxTextureArrayLayers));
				const historyScale = clamp(params.historyScale / 100, 0.01, 1);
				const historyWidth = Math.max(1, Math.round(resolution.width * historyScale));
				const historyHeight = Math.max(1, Math.round(resolution.height * historyScale));
				if (history == null || history.width !== historyWidth || history.height !== historyHeight || history.layers !== layers) {
					const next = createHistory(historyWidth, historyHeight, layers);
					history?.texture.destroy();
					history = next;
					clearHistory();
				}
				const geometry = getBlockGeometry(params.blockSize, getSizeReferenceLength(params.sizeReference, resolution), params.blockOrigin === 'center');
				if (blockResources == null || blockResources.width !== geometry.width || blockResources.height !== geometry.height) {
					const next = createBlockResources(geometry);
					blockResources?.dispose();
					blockResources = next;
					hasBlockState = false;
				}
				const gridSettings = `${params.sizeReference}:${params.blockSize}:${params.blockOrigin}:${params.seed}`;
				if (gridSettings !== previousGridSettings) hasBlockState = false;
				previousGridSettings = gridSettings;
				const input = params.input;
				const inputSettings = input.kind === 'texture'
					? `${input.kind}:${input.texture.width}:${input.texture.height}:${input.fitMode}:${input.wrapMode}:${input.filterMode}`
					: input.kind;
				if (inputSettings !== previousInputSettings) hasAnalysis = false;
				previousInputSettings = inputSettings;
				if (params.reset) clearHistory();
				const seconds = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				// 実際に描画した間隔を蓄積する。シーク先の時刻から同じ画像を再構築する処理は行わない。
				elapsedSeconds += seconds;
				const maxDelay = Math.max(0, params.maxDelay) / 1000;
				const captureInterval = maxDelay / (layers - 1);
				const shouldCapture = lastCaptureTime == null || seconds === 0 || elapsedSeconds - lastCaptureTime >= captureInterval;
				if (shouldCapture) {
					const advance = historyFrameCount > 0 && lastCaptureTime != null && elapsedSeconds > lastCaptureTime;
					if (advance) newestLayer = (newestLayer + 1) % layers;
					if (historyFrameCount === 0 || advance) historyFrameCount = Math.min(layers, historyFrameCount + 1);
					history.times[newestLayer] = elapsedSeconds;
					// 停止中は最新の保存先を上書きし、パラメータ編集の回数だけで履歴を押し流さない。
					lastCaptureTime = elapsedSeconds;
				}
				historyAges.fill(0);
				for (let index = 0; index < historyFrameCount; index++) {
					const layer = (newestLayer + layers - index) % layers;
					historyAges[layer] = Math.max(0, elapsedSeconds - history.times[layer]);
				}
				const motionHalfLife = Math.max(0, params.motionSmoothing) / 1000;
				seedValue[0] = params.seed;
				uniformValues.set({
					analysisSize: [analysisSize.width, analysisSize.height],
					blockSize: geometry.block, gridOrigin: geometry.origin, seconds, maxDelay,
					motionInfluence: clamp(params.motionInfluence, 0, 1),
					motionSensitivity: Math.max(0, params.motionSensitivity),
					motionThreshold: Math.max(0, params.motionThreshold),
					motionRetention: motionHalfLife > 0 ? Math.exp(-Math.LN2 * seconds / motionHalfLife) : 0,
					freezeRate: params.freezeEnabled ? Math.max(0, params.freezeRate) : 0,
					freezeDuration: Math.max(0, params.freezeDuration) / 1000,
					freezeThreshold: clamp(params.freezeThreshold, 0, 1),
					amount: clamp(params.amount, 0, 1), motionMode: motionModes[params.motionMode],
					resetBlocks: Number(!hasBlockState), hasMotion: Number(hasAnalysis),
					phase: Math.floor(elapsedSeconds * Math.max(0, params.patternRate)) >>> 0,
					frameIndex, seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					newestLayer, layerCount: layers, frameCount: historyFrameCount,
					interpolate: Number(params.interpolate), historyAges,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				if (shouldCapture) {
					const captured = captureHistory.update({ input }, ctx.outputDataMap.output.texture);
					const save = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [attachment(history.layerViews[newestLayer])] });
					save.setPipeline(captured.pipeline);
					save.setBindGroup(0, uniformGroup);
					save.setBindGroup(captureHistory.inputGroup, captured.bindGroup);
					save.draw(6);
					save.end();
				}
				const analyzed = captureAnalysis.update({ input }, ctx.outputDataMap.output.texture);
				const analyze = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [attachment(analysisViews[currentIndex])] });
				analyze.setPipeline(analyzed.pipeline);
				analyze.setBindGroup(0, uniformGroup);
				analyze.setBindGroup(captureAnalysis.inputGroup, analyzed.bindGroup);
				analyze.draw(6);
				analyze.end();
				const updated = updateBlocks.update({ delayMap: params.delayMap }, ctx.outputDataMap.output.texture);
				const update = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [attachment(blockResources.views[currentIndex])] });
				update.setPipeline(updated.pipeline);
				update.setBindGroup(0, blockResources.updateGroups[currentIndex]);
				update.setBindGroup(updateBlocks.inputGroup, updated.bindGroup);
				update.draw(6);
				update.end();
				const composed = compose.update({ input }, ctx.outputDataMap.output.texture);
				const render = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [attachment(ctx.outputDataMap.output.textureView), attachment(patchworkViews[currentIndex])],
				});
				render.setPipeline(composed.pipeline);
				render.setBindGroup(0, blockResources.composeGroup(currentIndex, history.view));
				render.setBindGroup(compose.inputGroup, composed.bindGroup);
				render.draw(6);
				render.end();
				hasAnalysis = true;
				hasBlockState = true;
				currentIndex = 1 - currentIndex;
				if (seconds > 0) frameIndex = (frameIndex + 1) >>> 0;
			},
			dispose: () => {
				captureHistory.dispose();
				captureAnalysis.dispose();
				updateBlocks.dispose();
				compose.dispose();
				history?.texture.destroy();
				blockResources?.dispose();
				for (const texture of analysisTextures) texture.destroy();
				for (const texture of patchworkTextures) texture.destroy();
				uniformBuffer.destroy();
			},
		};
	},
});
