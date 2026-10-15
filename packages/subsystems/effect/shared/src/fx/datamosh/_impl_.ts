import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import type { WrapMode } from '@gs/shared/types.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import reduceCode from './reduce.wgsl?raw';
import estimateCode from './estimate.wgsl?raw';
import composeCode from './compose.wgsl?raw';
import type definition from './_def_.ts';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default implementEffect<typeof definition>({
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enable32bitDataTextures }, resolution }) => {
		const motionFormat = enable32bitDataTextures ? 'rg32float' : 'rg16float';
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const uniformLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [uniformEntry] });
		const composeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const capture = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + captureCode,
			schema: { input: 'color' }, internalLayouts: [uniformLayout],
			targets: [{ format: motionFormat }], sampling: 'level0', entryPoint: 'capture',
		});
		const compose = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + composeCode,
			schema: { input: 'color', recoveryMask: 'scalar' }, internalLayouts: [composeLayout],
			targets: [{ format: intermediateTextureFormat }, { format: historyFormat }],
			sampling: 'level0', entryPoint: 'compose',
		});
		const reduce = device.createRenderPipeline({
			layout: 'auto', vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: reduceCode }), entryPoint: 'reduce', targets: [{ format: motionFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const estimate = device.createRenderPipeline({
			layout: 'auto', vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: commonCode + '\n' + estimateCode }), entryPoint: 'estimate', targets: [{ format: motionFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const linearSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		const historySamplers = new Map<WrapMode, GPUSampler>();
		const historySampler = (wrap: WrapMode) => {
			let sampler = historySamplers.get(wrap);
			if (sampler == null) {
				const addressMode = wrap === 'repeat' ? 'repeat' : wrap === 'repeatMirrored' ? 'mirror-repeat' : 'clamp-to-edge';
				sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: addressMode, addressModeV: addressMode });
				historySamplers.set(wrap, sampler);
			}
			return sampler;
		};
		const createTexture = (size: { width: number; height: number }, format: GPUTextureFormat, mipLevelCount = 1) => device.createTexture({
			size, format, mipLevelCount, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		// 動き推定の解像度だけを長辺512に固定する。過去の出力は別の原寸画像へ保持し、
		// プレビュー倍率や出力解像度を変えてもブロックの割合・推定の粒度が変わらないようにする。
		const analysisScale = 512 / Math.max(resolution.width, resolution.height);
		const analysisSize = {
			width: Math.max(1, Math.round(resolution.width * analysisScale)),
			height: Math.max(1, Math.round(resolution.height * analysisScale)),
		};
		const mipLevelCount = Math.floor(Math.log2(Math.max(analysisSize.width, analysisSize.height))) + 1;
		const images = [createTexture(analysisSize, motionFormat, mipLevelCount), createTexture(analysisSize, motionFormat, mipLevelCount)];
		const imageViews = images.map(texture => texture.createView());
		const mipViews = images.map(texture => Array.from({ length: mipLevelCount }, (_, baseMipLevel) => texture.createView({ baseMipLevel, mipLevelCount: 1 })));
		const reduceGroups = mipViews.map(views => views.slice(0, -1).map(view => device.createBindGroup({
			layout: reduce.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: linearSampler }, { binding: 1, resource: view }],
		})));
		const histories = [createTexture(resolution, historyFormat), createTexture(resolution, historyFormat)];
		const historyViews = histories.map(texture => texture.createView());

		const getGeometry = (blockSize: number) => {
			if (!Number.isFinite(blockSize) || blockSize <= 0) throw new Error('Datamoshing: block size must be a positive finite number.');
			const shortSide = Math.min(resolution.width, resolution.height);
			const block = [blockSize / 100 * shortSide / resolution.width, blockSize / 100 * shortSide / resolution.height];
			const width = Math.max(1, Math.ceil(1 / block[0]));
			const height = Math.max(1, Math.ceil(1 / block[1]));
			if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
				|| width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D) {
				throw new Error('Datamoshing: motion grid exceeds GPU texture limits. Increase Block size.');
			}
			return { width, height, block };
		};
		const createMotionResources = (size: { width: number; height: number }) => {
			const textures: GPUTexture[] = [];
			try {
				textures.push(createTexture(size, motionFormat));
				textures.push(createTexture(size, motionFormat));
				const views = textures.map(texture => texture.createView());
				const estimateGroups = views.map((_, index) => device.createBindGroup({
					layout: estimate.getBindGroupLayout(0),
					entries: [uniformEntry,
						{ binding: 1, resource: linearSampler },
						{ binding: 2, resource: imageViews[1 - index] },
						{ binding: 3, resource: imageViews[index] },
						{ binding: 4, resource: views[1 - index] },
					],
				}));
				const composeGroups = new Map<WrapMode, GPUBindGroup[]>();
				return {
					width: size.width, height: size.height, views, estimateGroups,
					composeGroup: (index: number, wrap: WrapMode) => {
						let groups = composeGroups.get(wrap);
						if (groups == null) {
							groups = views.map((view, current) => device.createBindGroup({
								layout: composeLayout,
								entries: [uniformEntry,
									{ binding: 1, resource: historySampler(wrap) },
									{ binding: 2, resource: historyViews[1 - current] },
									{ binding: 3, resource: view },
									{ binding: 4, resource: linearSampler },
								],
							}));
							composeGroups.set(wrap, groups);
						}
						return groups[index];
					},
					dispose: () => {
						for (const texture of textures) texture.destroy();
						composeGroups.clear();
					},
				};
			} catch (error) {
				for (const texture of textures) texture.destroy();
				throw error;
			}
		};
		let motionResources: ReturnType<typeof createMotionResources> | null = null;
		let current = 0;
		let hasHistory = false;
		let hasMotion = false;
		let hasFlow = false;
		let previousMotionSettings: string | null = null;
		let elapsedSinceReset = 0;
		let frameIndex = 0;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		const attachment = (view: GPUTextureView): GPURenderPassColorAttachment => ({
			view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store',
		});

		return {
			render: ctx => {
				const params = ctx.params;
				const geometry = getGeometry(params.blockSize);
				if (motionResources == null || motionResources.width !== geometry.width || motionResources.height !== geometry.height) {
					const next = createMotionResources(geometry);
					motionResources?.dispose();
					motionResources = next;
					hasFlow = false;
				}
				const motionInput = params.motionSource === 'input' ? params.input : params.motionInput;
				const motionSettings = params.motionSource + ':' + (motionInput.kind === 'texture'
					? `${motionInput.kind}:${motionInput.texture.width}:${motionInput.texture.height}:${motionInput.fitMode}:${motionInput.wrapMode}:${motionInput.filterMode}`
					: motionInput.kind);
				if (motionSettings !== previousMotionSettings) {
					// 入力の収め方の変更は動きと区別するが、色の履歴は消さない。
					// シーンの切り替わりを含め、過去の映像へ別の動きを乗せられることを優先する。
					hasMotion = false;
					hasFlow = false;
				}
				previousMotionSettings = motionSettings;
				const seconds = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				elapsedSinceReset += seconds;
				const resetInterval = Math.max(0, params.resetInterval);
				const reset = !hasHistory || params.reset || (resetInterval > 0 && elapsedSinceReset >= resetInterval);
				if (reset) elapsedSinceReset = 0;
				const canEstimateMotion = hasMotion && !reset && seconds > 0;
				const searchRadius = clamp(params.searchRange, 0, 100) / 100 * Math.min(analysisSize.width, analysisSize.height);
				const maxLevel = Math.min(mipLevelCount - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, searchRadius)))));
				const halfLife = Math.max(0, params.motionSmoothing) / 1000;
				seedValue[0] = params.seed;
				uniformValues.set({
					analysisSize: [analysisSize.width, analysisSize.height],
					blockSize: geometry.block,
					seconds, searchRadius,
					motionStrength: params.motionStrength,
					motionRetention: halfLife > 0 ? Math.exp(-Math.LN2 * seconds / halfLife) : 0,
					motionThreshold: Math.max(0, params.motionThreshold),
					matchThreshold: Math.max(0.000001, params.matchThreshold),
					recoveryRate: Math.max(0, params.recoveryRate),
					blockRefreshRate: Math.max(0, params.blockRefreshRate),
					frameIndex,
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					maxLevel,
					hasMotion: Number(canEstimateMotion),
					hasFlow: Number(hasFlow && canEstimateMotion),
					reset: Number(reset),
					blockyMotion: Number(params.blockyMotion),
					historyTransparent: Number(params.historyWrap === 'transparent'),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				// 生成入力のfitは元の出力サイズを基準にし、解析画像の丸めで配置が変わらないようにする。
				const captured = capture.update({ input: motionInput }, ctx.outputDataMap.output.texture);
				const save = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [attachment(mipViews[current][0])] });
				save.setPipeline(captured.pipeline);
				save.setBindGroup(0, uniformGroup);
				save.setBindGroup(capture.inputGroup, captured.bindGroup);
				save.draw(6);
				save.end();
				for (let level = 1; level < mipLevelCount; level++) {
					const downsample = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [attachment(mipViews[current][level])] });
					downsample.setPipeline(reduce);
					downsample.setBindGroup(0, reduceGroups[current][level - 1]);
					downsample.draw(6);
					downsample.end();
				}
				const solve = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [attachment(motionResources.views[current])] });
				solve.setPipeline(estimate);
				solve.setBindGroup(0, motionResources.estimateGroups[current]);
				solve.draw(6);
				solve.end();
				const composed = compose.update({ input: params.input, recoveryMask: params.recoveryMask }, ctx.outputDataMap.output.texture);
				const render = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [attachment(ctx.outputDataMap.output.textureView), attachment(historyViews[current])],
				});
				render.setPipeline(composed.pipeline);
				render.setBindGroup(0, motionResources.composeGroup(current, params.historyWrap));
				render.setBindGroup(compose.inputGroup, composed.bindGroup);
				render.draw(6);
				render.end();

				// 時刻からの再構築は行わない。シーク・逆再生も含め、実際に描画した順序を履歴とする。
				hasHistory = true;
				hasMotion = true;
				hasFlow = true;
				current = 1 - current;
				if (seconds > 0) frameIndex = (frameIndex + 1) >>> 0;
			},
			dispose: () => {
				capture.dispose();
				compose.dispose();
				motionResources?.dispose();
				for (const texture of images) texture.destroy();
				for (const texture of histories) texture.destroy();
				historySamplers.clear();
				uniformBuffer.destroy();
			},
		};
	},
});
