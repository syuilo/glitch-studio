import { createFixedInputBindings } from '../../shader-input.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createFixedInputPipeline, bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.wgsl?shader';
import captureCode from './capture.wgsl?raw';
import downsampleCode from './downsample-motion.wgsl?raw';
import updateBlocksCode from './update-blocks.wgsl?raw';
import captureSnapshotsCode from './capture-snapshots.wgsl?raw';
import backgroundCode from './background.wgsl?raw';
import renderBlocksCode from './render-blocks.wgsl?raw';
import type definition from './_def_.ts';

const backgroundModes = { input: 0, cutout: 1, transparent: 2 };
const blockStateStride = 32;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const analysisFormat = enable32bitDataTextures ? 'rg32float' : 'rg16float';
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const captureLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const captureGroup = device.createBindGroup({ layout: captureLayout, entries: [uniformEntry] });
		const updateLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
			{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const snapshotLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		const backgroundLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const renderBlocksLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		const createCapturePipeline = (input: typeof params.input, entryPoint: string, format: GPUTextureFormat) => createFixedInputPipeline({ input }, resolution, {
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + captureCode,
			schema: { input: 'color' }, internalLayouts: [captureLayout],
			sampling: 'level0', entryPoint, targets: [{ format }],
		});
		const captureInput = createCapturePipeline(params.input, 'capture_input', historyFormat);
		const inputMotionCapture = createCapturePipeline(params.input, 'capture_motion', analysisFormat);
		const alternateMotion = createCapturePipeline(params.motionInput, 'capture_motion', analysisFormat);
		const background = createFixedInputPipeline(params, resolution, {
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + backgroundCode,
			schema: { input: 'color' }, internalLayouts: [backgroundLayout], sampling: 'level0',
			entryPoint: 'background', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		const downsample = device.createRenderPipeline({
			layout: 'auto', vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: downsampleCode }), entryPoint: 'downsample_motion', targets: [{ format: analysisFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const captureSnapshots = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [snapshotLayout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: commonCode + '\n' + captureSnapshotsCode }), entryPoint: 'capture_snapshots', targets: [{ format: historyFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const blockShader = device.createShaderModule({ code: commonCode + '\n' + renderBlocksCode });
		const renderBlocks = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [renderBlocksLayout] }),
			vertex: { module: blockShader, entryPoint: 'block_vertex' },
			fragment: {
				module: blockShader, entryPoint: 'block_fragment',
				targets: [{
					format: INTERMEDIATE_TEXTURE_FORMAT,
					blend: {
						color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
						alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
					},
				}],
			},
			primitive: { topology: 'triangle-list' },
		});
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		const createTexture = (size: { width: number; height: number }, format: GPUTextureFormat, mipLevelCount = 1) => device.createTexture({
			size, format, mipLevelCount, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		// 解析だけを長辺512へ縮小し、切り出し元と保存画像は元の出力解像度を維持する。
		const analysisScale = 512 / Math.max(resolution.width, resolution.height);
		const analysisSize = {
			width: Math.max(1, Math.round(resolution.width * analysisScale)),
			height: Math.max(1, Math.round(resolution.height * analysisScale)),
		};
		const mipLevelCount = Math.floor(Math.log2(Math.max(analysisSize.width, analysisSize.height))) + 1;
		const analysisTextures = [createTexture(analysisSize, analysisFormat, mipLevelCount), createTexture(analysisSize, analysisFormat, mipLevelCount)];
		const analysisViews = analysisTextures.map(texture => texture.createView());
		const mipViews = analysisTextures.map(texture => Array.from({ length: mipLevelCount }, (_, baseMipLevel) => texture.createView({ baseMipLevel, mipLevelCount: 1 })));
		const downsampleGroups = mipViews.map(views => views.slice(0, -1).map(view => device.createBindGroup({
			layout: downsample.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: view }],
		})));
		// 前回の入力は全描画の最後に上書きする。切り出しで読み終えてから保存するため、
		// 入力履歴もスナップショットも原寸画像を1枚ずつで済ませられる。
		const previousInput = createTexture(resolution, historyFormat);
		const previousInputView = previousInput.createView();
		const snapshots = createTexture(resolution, historyFormat);
		const snapshotsView = snapshots.createView();
		const createUpdateStage = () => {
			const bindings = createFixedInputBindings(device, { spawnMask: 'scalar' }, params, resolution, 1, 'level0');
			try {
				const pipeline = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [updateLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: bindings.code + '\n' + commonCode + '\n' + updateBlocksCode }), entryPoint: 'update_blocks' },
				});
				return { pipeline, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		};
		const update = createUpdateStage();
		const getBlockGeometry = (blockSize: number, referenceLength: number, centered: boolean) => {
			if (!Number.isFinite(blockSize) || blockSize <= 0) throw new Error('Sliding Blocks: block size must be a positive finite number.');
			const block = [blockSize / 100 * referenceLength / resolution.width, blockSize / 100 * referenceLength / resolution.height];
			// 中央基準は奇数個で中央のセルを固定し、サイズ変更中も中心が半ブロックずれないようにする。
			const countBlocks = (axisSize: number) => centered
				? Math.max(1, Math.ceil(0.5 / axisSize - 0.5) * 2 + 1)
				: Math.max(1, Math.ceil(1 / axisSize));
			const width = countBlocks(block[0]);
			const height = countBlocks(block[1]);
			const blockCount = width * height;
			const bufferSize = blockCount * blockStateStride;
			if (!Number.isSafeInteger(bufferSize) || bufferSize > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| Math.ceil(blockCount / 64) > device.limits.maxComputeWorkgroupsPerDimension) {
				throw new Error('Sliding Blocks: block grid exceeds GPU resource limits. Increase Block Size.');
			}
			return { width, height, blockCount, bufferSize, block, origin: centered ? [0.5 - width * block[0] * 0.5, 0.5 - height * block[1] * 0.5] : [0, 0] };
		};
		const createBlockResources = (geometry: ReturnType<typeof getBlockGeometry>) => {
			const buffers: GPUBuffer[] = [];
			try {
				buffers.push(device.createBuffer({ size: geometry.bufferSize, usage: GPUBufferUsage.STORAGE }));
				buffers.push(device.createBuffer({ size: geometry.bufferSize, usage: GPUBufferUsage.STORAGE }));
				return {
					width: geometry.width, height: geometry.height,
					updateGroups: buffers.map((buffer, index) => device.createBindGroup({
						layout: updateLayout,
						entries: [uniformEntry, { binding: 1, resource: sampler },
							{ binding: 2, resource: analysisViews[1 - index] }, { binding: 3, resource: analysisViews[index] },
							{ binding: 4, resource: { buffer: buffers[1 - index] } }, { binding: 5, resource: { buffer } },
						],
					})),
					snapshotGroups: buffers.map(buffer => device.createBindGroup({
						layout: snapshotLayout,
						entries: [uniformEntry, { binding: 1, resource: { buffer } }, { binding: 2, resource: previousInputView }],
					})),
					backgroundGroups: buffers.map(buffer => device.createBindGroup({
						layout: backgroundLayout, entries: [uniformEntry, { binding: 1, resource: { buffer } }],
					})),
					renderGroups: buffers.map(buffer => device.createBindGroup({
						layout: renderBlocksLayout,
						entries: [uniformEntry, { binding: 1, resource: { buffer } }, { binding: 2, resource: sampler }, { binding: 3, resource: snapshotsView }],
					})),
					dispose: () => { for (const buffer of buffers) buffer.destroy(); },
				};
			} catch (error) {
				for (const buffer of buffers) buffer.destroy();
				throw error;
			}
		};
		let blockResources: ReturnType<typeof createBlockResources> | null = null;
		let currentIndex = 0;
		let hasAnalysis = false;
		let hasBlockState = false;
		let previousGridSettings: string | null = null;
		let previousMotionSettings: string | null = null;
		let frameIndex = 0;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		const attachment = (view: GPUTextureView, loadOp: GPULoadOp = 'clear'): GPURenderPassColorAttachment => ({
			view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp, storeOp: 'store',
		});

		return {
			resetRenderHistory() {
				currentIndex = 0;
				frameIndex = 0;
				hasBlockState = false;
				hasAnalysis = false;
			},
			render: ctx => {
				const referenceScale = getSizeReferenceLength(params.sizeReference, resolution) / Math.min(resolution.width, resolution.height);
				const geometry = getBlockGeometry(params.blockSize, getSizeReferenceLength(params.sizeReference, resolution), params.blockOrigin === 'center');
				if (blockResources == null || blockResources.width !== geometry.width || blockResources.height !== geometry.height) {
					const next = createBlockResources(geometry);
					blockResources?.dispose();
					blockResources = next;
					hasBlockState = false;
				}
				const gridSettings = `${params.sizeReference}:${params.blockSize}:${params.blockOrigin}`;
				if (gridSettings !== previousGridSettings) {
					// 保存画像の各セルの所有者が変わるので、サイズ・原点の変更時には断片を作り直す。
					hasBlockState = false;
				}
				previousGridSettings = gridSettings;
				const captureMotion = params.motionSource === 'input' ? inputMotionCapture : alternateMotion;
				const motionSettings = params.motionSource;
				if (motionSettings !== previousMotionSettings) hasAnalysis = false;
				previousMotionSettings = motionSettings;
				const seconds = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				const resetBlocks = !hasBlockState || params.reset;
				const searchRadius = clamp(params.searchRange, 0, 100) / 100 * getSizeReferenceLength(params.sizeReference, analysisSize);
				seedValue[0] = params.seed;
				uniformValues.set({
					analysisSize: [analysisSize.width, analysisSize.height], outputSize: [resolution.width, resolution.height],
					blockSize: geometry.block, gridOrigin: geometry.origin, gridSize: [geometry.width, geometry.height],
					seconds, searchRadius,
					maxSearchLevel: Math.min(mipLevelCount - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, searchRadius))))),
					hasMotion: Number(hasAnalysis && !resetBlocks && seconds > 0), resetBlocks: Number(resetBlocks), frameIndex,
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					motionSpeedThreshold: Math.max(0, params.motionSpeedThreshold) / 100 * referenceScale,
					matchThreshold: Math.max(0.000001, params.matchThreshold), spawnRate: Math.max(0, params.spawnRate),
					lifetime: Math.max(0, params.lifetime) / 1000, lifetimeRandomness: clamp(params.lifetimeRandomness, 0, 1),
					velocityStrength: params.velocityStrength, motionRotation: -params.motionRotation * (2 * Math.PI),
					driftSpeed: Math.max(0, params.driftSpeed) / 100 * referenceScale, drag: Math.max(0, params.drag),
					cooldown: Math.max(0, params.cooldown) / 1000, fadeOut: clamp(params.fadeOut, 0, 1),
					amount: clamp(params.amount, 0, 1), backgroundMode: backgroundModes[params.background],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				// 入力のfitは解析サイズでなく、実際の出力画像の寸法を基準にする。
				const analysisPass = ctx.commandEncoder.beginRenderPass({ colorAttachments: [attachment(mipViews[currentIndex][0])] });
				analysisPass.setPipeline(captureMotion.pipeline);
				analysisPass.setBindGroup(0, captureGroup);
				analysisPass.setBindGroup(captureMotion.inputGroup, captureMotion.getBindGroup());
				analysisPass.draw(3);
				analysisPass.end();
				for (let level = 1; level < mipLevelCount; level++) {
					const downsamplePass = ctx.commandEncoder.beginRenderPass({ colorAttachments: [attachment(mipViews[currentIndex][level])] });
					downsamplePass.setPipeline(downsample);
					downsamplePass.setBindGroup(0, downsampleGroups[currentIndex][level - 1]);
					downsamplePass.draw(3);
					downsamplePass.end();
				}
				const maskGroup = update.bindings.getBindGroup();
				const updatePass = ctx.commandEncoder.beginComputePass();
				updatePass.setPipeline(update.pipeline);
				updatePass.setBindGroup(0, blockResources.updateGroups[currentIndex]);
				updatePass.setBindGroup(1, maskGroup);
				updatePass.dispatchWorkgroups(Math.ceil(geometry.blockCount / 64));
				updatePass.end();
				const snapshotPass = ctx.commandEncoder.beginRenderPass({ colorAttachments: [attachment(snapshotsView, 'load')] });
				snapshotPass.setPipeline(captureSnapshots);
				snapshotPass.setBindGroup(0, blockResources.snapshotGroups[currentIndex]);
				snapshotPass.draw(3);
				snapshotPass.end();
				const outputPass = beginOutputPass(ctx.commandEncoder, outputView);
				outputPass.setPipeline(background.pipeline);
				outputPass.setBindGroup(0, blockResources.backgroundGroups[currentIndex]);
				outputPass.setBindGroup(background.inputGroup, background.getBindGroup());
				outputPass.draw(3);
				outputPass.setPipeline(renderBlocks);
				outputPass.setBindGroup(0, blockResources.renderGroups[currentIndex]);
				outputPass.draw(6, geometry.blockCount);
				outputPass.end();

				// スナップショットの参照が終わってから次回の入力を保存する。描画順序が履歴となる。
				const saveInputPass = ctx.commandEncoder.beginRenderPass({ colorAttachments: [attachment(previousInputView)] });
				saveInputPass.setPipeline(captureInput.pipeline);
				saveInputPass.setBindGroup(0, captureGroup);
				saveInputPass.setBindGroup(captureInput.inputGroup, captureInput.getBindGroup());
				saveInputPass.draw(3);
				saveInputPass.end();
				hasAnalysis = true;
				hasBlockState = true;
				currentIndex = 1 - currentIndex;
				if (seconds > 0) frameIndex = (frameIndex + 1) >>> 0;
			},
			dispose: () => {
				captureInput.dispose();
				inputMotionCapture.dispose();
				alternateMotion.dispose();
				background.dispose();
				update.bindings.dispose();
				blockResources?.dispose();
				for (const texture of analysisTextures) texture.destroy();
				previousInput.destroy();
				snapshots.destroy();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
