import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createFixedInputBindings } from '../../shader-input.ts';
import { bindParameterValues } from '../../multipass.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.wgsl?shader';
import captureCode from './capture.wgsl?raw';
import pyramidCode from './pyramid.wgsl?raw';
import analysisCode from './analysis.wgsl?raw';
import estimateCode from './estimate.wgsl?raw';
import confidenceCode from './confidence.wgsl?raw';
import inverseCode from './inverse.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type definition from './_def_.ts';
import type { NativeParameterValues } from '../../multipass.ts';

type Parameters = NativeParameterValues<typeof definition.paramDefs>;
type AnalysisLevel = { size: { width: number; height: number }; virtualSize: [number, number] };
const outputPorts = ['output', 'warpA', 'warpB', 'confidence'] as const;
const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, lower: number, upper: number) => Math.min(upper, Math.max(lower, value));

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const dataFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const vectorFormat = enable32bitDataTextures ? 'rg32float' : 'rg16float';
		const scalarFormat = enable32bitDataTextures ? 'r32float' : 'r16float';
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
		const uniformSize = uniformValues.arrayBuffer.byteLength;
		const uniformStride = Math.ceil(uniformSize / device.limits.minUniformBufferOffsetAlignment) * device.limits.minUniformBufferOffsetAlignment;
		const uniformLayoutEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } };
		const captureLayout = device.createBindGroupLayout({ entries: [uniformLayoutEntry] });
		const imageEntries: GPUBindGroupLayoutEntry[] = [
			uniformLayoutEntry,
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		];
		const imageLayout = device.createBindGroupLayout({ entries: imageEntries });
		const analysisLayout = device.createBindGroupLayout({ entries: [
			...imageEntries,
			{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		// 捕捉と各出力で参照するA/BとFit領域は共通。入力の転送は全パスを通して1回でよい。
		const imageInputs = createFixedInputBindings(device, { inputA: 'color', inputB: 'color' }, params, resolution, 1, 'level0');
		const capture = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [captureLayout, imageInputs.layout] }),
			vertex: { module: defaultVertexShaderModule }, fragment: {
				module: device.createShaderModule({ code: [imageInputs.code, commonCode, captureCode].join('\n') }),
				entryPoint: 'capture', targets: [{ format: dataFormat }, { format: dataFormat }],
			},
		});
		const outputLayout = device.createPipelineLayout({ bindGroupLayouts: [imageLayout, imageInputs.layout] });
		const outputModule = device.createShaderModule({ code: [imageInputs.code, commonCode, outputCode].join('\n') });
		const outputEntryPoints = { output: 'fs', warpA: 'warpA', warpB: 'warpB', confidence: 'confidence' };
		const outputStages = outputPorts.flatMap(port => {
			const texture = outputTextures.get(port);
			if (texture == null) return [];
			return [{ view: texture.createView(), pipeline: device.createRenderPipeline({
				layout: outputLayout, vertex: { module: defaultVertexShaderModule },
				fragment: { module: outputModule, entryPoint: outputEntryPoints[port], targets: [{ format: texture.format }] },
			}) }];
		});
		const createPipeline = (code: string, entryPoint: string, layout: GPUBindGroupLayout, formats: GPUTextureFormat[]) => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: commonCode + '\n' + code }), entryPoint, targets: formats.map(format => ({ format })) },
		});
		const reduce = createPipeline(pyramidCode, 'reduce', imageLayout, [dataFormat, dataFormat]);
		const estimate = createPipeline(analysisCode + '\n' + estimateCode, 'estimate', analysisLayout, [dataFormat]);
		const confidence = createPipeline(analysisCode + '\n' + confidenceCode, 'confidence', analysisLayout, [vectorFormat]);
		const inverse = createPipeline(inverseCode, 'inverse', imageLayout, [dataFormat, scalarFormat]);
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		const samplerEntry = { binding: 1, resource: sampler };
		const getGeometry = (params: Parameters) => {
			if (!Number.isFinite(params.analysisResolution) || params.analysisResolution < 4) throw new Error('Image Morph: Analysis Resolution must be a finite number of at least 4.');
			const analysisResolution = Math.round(params.analysisResolution);
			const shortSide = Math.min(resolution.width, resolution.height);
			const requestedLevels = clamp(Math.round(finiteOr(params.pyramidLevels, 4)), 1, 6);
			const levels: AnalysisLevel[] = [];
			for (let level = 0; level < requestedLevels; level++) {
				const scale = analysisResolution / shortSide / (2 ** level);
				const virtualSize: [number, number] = [resolution.width * scale, resolution.height * scale];
				if (Math.min(...virtualSize) < 4) break;
				const size = { width: Math.ceil(virtualSize[0]), height: Math.ceil(virtualSize[1]) };
				if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)
					|| size.width > device.limits.maxTextureDimension2D || size.height > device.limits.maxTextureDimension2D) {
					throw new Error('Image Morph: analysis image exceeds GPU texture limits. Reduce Analysis Resolution.');
				}
				levels.push({ size, virtualSize });
			}
			return { analysisResolution, levels };
		};
		const createResources = (geometry: ReturnType<typeof getGeometry>, uniformCapacity: number) => {
			const textures: GPUTexture[] = [];
			const uniformBytes = new Uint8Array(uniformStride * uniformCapacity);
			const uniformBuffer = device.createBuffer({ size: uniformBytes.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer, size: uniformSize } };
			const createTexture = (size: { width: number; height: number }, format: GPUTextureFormat) => {
				const texture = device.createTexture({ size, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
				textures.push(texture);
				return texture.createView();
			};
			const imageGroup = (first: GPUTextureView, second: GPUTextureView) => device.createBindGroup({ layout: imageLayout, entries: [uniformEntry, samplerEntry, { binding: 2, resource: first }, { binding: 3, resource: second }] });
			const dispose = () => { uniformBuffer.destroy(); for (const texture of textures) texture.destroy(); };
			try {
				const zeroFlowView = createTexture({ width: 1, height: 1 }, dataFormat);
				const levels = geometry.levels.map(level => {
					const imageViews = [createTexture(level.size, dataFormat), createTexture(level.size, dataFormat)];
					const flowViews = [createTexture(level.size, dataFormat), createTexture(level.size, dataFormat)];
					const analysisGroups = new Map<GPUTextureView, GPUBindGroup>();
					return {
						...level, imageViews, flowViews,
						analysisGroup: (previousFlow: GPUTextureView) => {
							let group = analysisGroups.get(previousFlow);
							if (group == null) {
								group = device.createBindGroup({ layout: analysisLayout, entries: [uniformEntry, samplerEntry, { binding: 2, resource: imageViews[0] }, { binding: 3, resource: imageViews[1] }, { binding: 4, resource: previousFlow }] });
								analysisGroups.set(previousFlow, group);
							}
							return group;
						},
					};
				});
				const firstLevel = levels[0];
				const confidenceView = createTexture(firstLevel.size, vectorFormat);
				const warpView = createTexture(firstLevel.size, dataFormat);
				const intermediateConfidenceView = createTexture(firstLevel.size, scalarFormat);
				return {
					analysisResolution: geometry.analysisResolution, levels, uniformCapacity, uniformBytes, uniformBuffer, zeroFlowView, confidenceView, warpView, intermediateConfidenceView,
					captureGroup: device.createBindGroup({ layout: captureLayout, entries: [uniformEntry] }),
					pyramidGroups: levels.slice(1).map((_, index) => imageGroup(levels[index].imageViews[0], levels[index].imageViews[1])),
					inverseGroups: firstLevel.flowViews.map(view => imageGroup(view, confidenceView)),
					outputGroup: imageGroup(warpView, intermediateConfidenceView), dispose,
				};
			} catch (error) {
				dispose();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const geometry = getGeometry(params);
				const iterations = clamp(Math.round(finiteOr(params.iterations, 8)), 1, 32);
				const uniformCapacity = geometry.levels.length * (iterations + 1) + 3;
				if (resources == null || resources.analysisResolution !== geometry.analysisResolution || resources.levels.length !== geometry.levels.length || resources.uniformCapacity < uniformCapacity) {
					const next = createResources(geometry, uniformCapacity);
					resources?.dispose();
					resources = next;
				}
				const frameResources = resources;
				const firstLevel = frameResources.levels[0];
				const progress = clamp(finiteOr(params.progress, 0.5), 0, 1);
				const baseUniforms = {
					canvasExtent: [resolution.width / Math.max(resolution.width, resolution.height), resolution.height / Math.max(resolution.width, resolution.height)],
					progress, warpStrength: clamp(finiteOr(params.warpStrength, 1), 0, 2),
					blend: params.linkBlendToProgress ? progress : clamp(finiteOr(params.blend, 0.5), 0, 1),
					searchRange: clamp(finiteOr(params.searchRange, 0.2), 0, 0.5),
					smoothness: clamp(finiteOr(params.smoothness, 0.05), 0, 1), confidenceGuard: Number(params.confidenceGuard),
				};
				let uniformIndex = 0;
				const appendUniform = (level: AnalysisLevel, changes: { sourceSize?: readonly number[]; flowSize?: readonly number[]; stepScale?: number } = {}) => {
					uniformValues.set({ ...baseUniforms, analysisSize: level.virtualSize, sourceSize: level.virtualSize, flowSize: level.virtualSize, stepScale: 1, ...changes });
					const offset = uniformIndex++ * uniformStride;
					frameResources.uniformBytes.set(new Uint8Array(uniformValues.arrayBuffer), offset);
					return offset;
				};
				const draw = (pipeline: GPURenderPipeline, group: GPUBindGroup, offset: number, views: GPUTextureView[], inputBinding: { index: number; group: GPUBindGroup } | null = null) => {
					const pass = commandEncoder.beginRenderPass({ colorAttachments: views.map(view => ({ view, loadOp: 'clear', storeOp: 'store' })) });
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, group, [offset]);
					if (inputBinding != null) pass.setBindGroup(inputBinding.index, inputBinding.group);
					pass.draw(3);
					pass.end();
				};
				// 入力のFitは最終出力の寸法を基準にする。解析textureの切り上げに追従させない。

				const inputBinding = { index: 1, group: imageInputs.getBindGroup() };
				draw(capture, frameResources.captureGroup, appendUniform(firstLevel), firstLevel.imageViews, inputBinding);
				for (let level = 1; level < frameResources.levels.length; level++) {
					draw(reduce, frameResources.pyramidGroups[level - 1], appendUniform(frameResources.levels[level], { sourceSize: frameResources.levels[level - 1].virtualSize }), frameResources.levels[level].imageViews);
				}
				// 毎回0から推定する。前回のフローを初期値にして描画順へ依存させない。
				const clear = commandEncoder.beginRenderPass({ colorAttachments: [{ view: frameResources.zeroFlowView, loadOp: 'clear', storeOp: 'store' }] });
				clear.end();
				let previousFlow = frameResources.zeroFlowView;
				let previousSize: readonly number[] = [1, 1];
				for (let index = frameResources.levels.length - 1; index >= 0; index--) {
					const level = frameResources.levels[index];
					for (let iteration = 0; iteration < iterations; iteration++) {
						const nextFlow = level.flowViews[iteration % 2];
						const offset = appendUniform(level, { flowSize: previousSize, stepScale: iteration < Math.ceil(iterations / 2) ? 1 : 0.5 });
						draw(estimate, level.analysisGroup(previousFlow), offset, [nextFlow]);
						previousFlow = nextFlow;
						previousSize = level.virtualSize;
					}
				}
				draw(confidence, firstLevel.analysisGroup(previousFlow), appendUniform(firstLevel), [frameResources.confidenceView]);
				draw(inverse, frameResources.inverseGroups[(iterations - 1) % 2], appendUniform(firstLevel), [frameResources.warpView, frameResources.intermediateConfidenceView]);
				const outputOffset = appendUniform(firstLevel);
				for (const { view, pipeline } of outputStages) {
					draw(pipeline, frameResources.outputGroup, outputOffset, [view], inputBinding);
				}
				// 各dispatchのuniformを別領域へ置き、最後にまとめて転送する。
				// queueへの投入前の書き換えで、前の階層や反復の設定まで変えない。
				device.queue.writeBuffer(frameResources.uniformBuffer, 0, frameResources.uniformBytes, 0, uniformIndex * uniformStride);
			},
			dispose: () => {
				resources?.dispose();
				imageInputs.dispose();
			},
		};
	},
};

export default implementation;
