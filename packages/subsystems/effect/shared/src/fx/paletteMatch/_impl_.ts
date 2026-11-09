import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import colorCode from '@gs/shared/gpu/oklab.wgsl?raw';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import analyzeCode from './analyze.wgsl?raw';
import matrixCode from './matrix.wgsl?raw';
import transformCode from './transform.wgsl?raw';
import outputCode from './shader.wgsl?raw';
import type definition from './_def_.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';

const inputSchema = { input: 'color', reference: 'color', inputAnalysisMask: 'scalar', referenceAnalysisMask: 'scalar' } as const;
type Inputs = Record<keyof typeof inputSchema, ShaderInput>;
const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule } }) => {
		const definitions = makeShaderDataDefinitions(commonCode);
		const uniformValues = makeStructuredView(definitions.uniforms.uniforms);
		const partialStride = makeStructuredView(definitions.structs.StatisticsPair).arrayBuffer.byteLength;
		const transformSize = makeStructuredView(definitions.structs.PaletteTransform).arrayBuffer.byteLength;
		const analyzeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const transformLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const outputLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const buildTransform = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [transformLayout] }),
			compute: { module: device.createShaderModule({ code: commonCode + '\n' + matrixCode + '\n' + transformCode }), entryPoint: 'buildTransform' },
		});
		const createVariant = (inputs: Inputs) => {
			const generated = generateShaderInputs(inputSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + commonCode + '\n' + colorCode + '\n';
				return {
					bindings,
					analyze: device.createComputePipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [analyzeLayout, bindings.layout] }),
						compute: { module: device.createShaderModule({ code: prefix + analyzeCode }), entryPoint: 'analyze' },
					}),
					output: device.createRenderPipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
						vertex: { module: defaultVertexShaderModule },
						fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
						primitive: { topology: 'triangle-list' },
					}),
				};
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		};
		const variants = new Map<string, ReturnType<typeof createVariant>>();
		const getVariant = (inputs: Inputs) => {
			const key = shaderInputVariantKey(inputSchema, inputs);
			let variant = variants.get(key);
			if (variant == null) {
				variant = createVariant(inputs);
				variants.set(key, variant);
			}
			return variant;
		};
		const createResources = (partialCapacity: number) => {
			const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			const partialStatistics = device.createBuffer({ size: partialCapacity * partialStride, usage: GPUBufferUsage.STORAGE });
			const transform = device.createBuffer({ size: transformSize, usage: GPUBufferUsage.STORAGE });
			const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
			const partialEntry = { binding: 1, resource: { buffer: partialStatistics } };
			const dispose = () => {
				uniformBuffer.destroy();
				partialStatistics.destroy();
				transform.destroy();
			};
			try {
				return {
					partialCapacity,
					uniformBuffer,
					analyzeGroup: device.createBindGroup({ layout: analyzeLayout, entries: [uniformEntry, partialEntry] }),
					transformGroup: device.createBindGroup({ layout: transformLayout, entries: [uniformEntry, partialEntry, { binding: 2, resource: { buffer: transform } }] }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries: [uniformEntry, { binding: 1, resource: { buffer: transform } }] }),
					dispose,
				};
			} catch (error) {
				dispose();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		return {
			render: ctx => {
				const { input, reference, inputAnalysisMask, referenceAnalysisMask } = ctx.params;
				const sampleCount = clamp(Math.round(finiteOr(ctx.params.analysisSamples, 4096)), 1, 65536);
				const partialCount = Math.ceil(sampleCount / 64);
				const storageLimit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
				if (partialCount > device.limits.maxComputeWorkgroupsPerDimension || partialCount * partialStride > storageLimit) {
					throw new Error('Palette Match: analysis exceeds GPU resource limits. Reduce Analysis Samples.');
				}
				if (resources == null || resources.partialCapacity < partialCount) {
					const nextResources = createResources(partialCount);
					resources?.dispose();
					resources = nextResources;
				}
				const lightnessMatch = clamp(finiteOr(ctx.params.lightnessMatch, 0), 0, 1);
				const chromaMatch = clamp(finiteOr(ctx.params.chromaMatch, 1), 0, 1);
				uniformValues.set({ sampleCount, partialCount, lightnessMatch, chromaMatch, maximumGain: clamp(finiteOr(ctx.params.maximumGain, 4), 1, 16) });
				device.queue.writeBuffer(resources.uniformBuffer, 0, uniformValues.arrayBuffer);
				const inputs = { input, reference, inputAnalysisMask, referenceAnalysisMask };
				const variant = getVariant(inputs);
				const inputGroup = variant.bindings.update(inputs, ctx.outputDataMap.output.texture);
				if (lightnessMatch > 0 || chromaMatch > 0) {
					const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
					compute.setPipeline(variant.analyze);
					compute.setBindGroup(0, resources.analyzeGroup);
					compute.setBindGroup(1, inputGroup);
					compute.dispatchWorkgroups(partialCount);
					compute.setPipeline(buildTransform);
					compute.setBindGroup(0, resources.transformGroup);
					compute.dispatchWorkgroups(1);
					compute.end();
				}
				const output = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				output.setPipeline(variant.output);
				output.setBindGroup(0, resources.outputGroup);
				output.setBindGroup(1, inputGroup);
				output.draw(3);
				output.end();
			},
			dispose: () => {
				resources?.dispose();
				for (const variant of variants.values()) variant.bindings.dispose();
				variants.clear();
			},
		};
	},
});
