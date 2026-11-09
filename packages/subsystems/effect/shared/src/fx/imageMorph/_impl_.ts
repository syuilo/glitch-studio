import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import pyramidCode from './pyramid.wgsl?raw';
import analysisCode from './analysis.wgsl?raw';
import estimateCode from './estimate.wgsl?raw';
import confidenceCode from './confidence.wgsl?raw';
import inverseCode from './inverse.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type AnalysisLevel = { size: { width: number; height: number }; virtualSize: [number, number] };
const outputPorts = ['output', 'warpA', 'warpB', 'confidence'] as const;
const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, lower: number, upper: number) => Math.min(upper, Math.max(lower, value));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
		warpA: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
		warpB: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
		confidence: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, enable32bitDataTextures }, resolution }) => {
		const dataFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const vectorFormat = enable32bitDataTextures ? 'rg32float' : 'rg16float';
		const scalarFormat = enable32bitDataTextures ? 'r32float' : 'r16float';
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
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
		const capturePipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + captureCode,
			schema: { inputA: 'color', inputB: 'color' }, targets: [{ format: dataFormat }, { format: dataFormat }],
			internalLayouts: [captureLayout], sampling: 'level0', entryPoint: 'capture',
		});
		const outputFormats: Record<typeof outputPorts[number], GPUTextureFormat> = { output: INTERMEDIATE_TEXTURE_FORMAT, warpA: vectorFormat, warpB: vectorFormat, confidence: scalarFormat };
		const outputEntryPoints = { output: 'fs', warpA: 'warpA', warpB: 'warpB', confidence: 'confidence' };
		const outputPipelines = Object.fromEntries(outputPorts.map(port => [port, createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + outputCode,
			schema: { inputA: 'color', inputB: 'color' }, targets: [{ format: outputFormats[port] }],
			internalLayouts: [imageLayout], sampling: 'level0', entryPoint: outputEntryPoints[port],
		})])) as Record<typeof outputPorts[number], ReturnType<typeof createShaderInputPipeline>>;
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
			render: ctx => {
				if (outputPorts.every(port => ctx.outputDataMap[port] == null || ctx.usedOutputPorts?.has(port) === false)) return;
				const params = ctx.params;
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
					const pass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: views.map(view => ({ view, loadOp: 'clear', storeOp: 'store' })) });
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, group, [offset]);
					if (inputBinding != null) pass.setBindGroup(inputBinding.index, inputBinding.group);
					pass.draw(3);
					pass.end();
				};
				const inputs = { inputA: params.inputA, inputB: params.inputB };
				// 入力のFitは最終出力の寸法を基準にする。解析textureの切り上げに追従させない。
				const referenceTexture = ctx.outputDataMap.output.texture;
				const capture = capturePipelines.update(inputs, referenceTexture);
				draw(capture.pipeline, frameResources.captureGroup, appendUniform(firstLevel), firstLevel.imageViews, { index: capturePipelines.inputGroup, group: capture.bindGroup });
				for (let level = 1; level < frameResources.levels.length; level++) {
					draw(reduce, frameResources.pyramidGroups[level - 1], appendUniform(frameResources.levels[level], { sourceSize: frameResources.levels[level - 1].virtualSize }), frameResources.levels[level].imageViews);
				}
				// 毎回0から推定する。前回のフローを初期値にして描画順へ依存させない。
				const clear = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [{ view: frameResources.zeroFlowView, loadOp: 'clear', storeOp: 'store' }] });
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
				for (const port of outputPorts) {
					const output = ctx.outputDataMap[port];
					if (output == null || ctx.usedOutputPorts?.has(port) === false) continue;
					const pipelines = outputPipelines[port];
					const variant = pipelines.update(inputs, referenceTexture);
					draw(variant.pipeline, frameResources.outputGroup, outputOffset, [output.textureView], { index: pipelines.inputGroup, group: variant.bindGroup });
				}
				// 各dispatchのuniformを別領域へ置き、最後にまとめて転送する。
				// queueへの投入前の書き換えで、前の階層や反復の設定まで変えない。
				device.queue.writeBuffer(frameResources.uniformBuffer, 0, frameResources.uniformBytes, 0, uniformIndex * uniformStride);
			},
			dispose: () => {
				resources?.dispose();
				capturePipelines.dispose();
				for (const pipeline of Object.values(outputPipelines)) pipeline.dispose();
			},
		};
	},
});
