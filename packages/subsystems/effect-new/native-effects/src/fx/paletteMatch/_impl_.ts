import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import colorCode from '@gs/shared/gpu/oklab.wgsl?raw';
import { createFixedInputBindings } from '../../shader-input.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import commonCode, { uniforms as commonCodeUniforms, structs as commonCodeStructs } from './common.wgsl?shader';
import analyzeCode from './analyze.wgsl?raw';
import matrixCode from './matrix.wgsl?raw';
import transformCode from './transform.wgsl?raw';
import outputCode from './shader.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const inputSchema = { input: 'color', reference: 'color', inputAnalysisMask: 'scalar', referenceAnalysisMask: 'scalar' } as const;
const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
		const partialStride = createShaderBuffer(commonCodeStructs.StatisticsPair).arrayBuffer.byteLength;
		const transformSize = createShaderBuffer(commonCodeStructs.PaletteTransform).arrayBuffer.byteLength;
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

		function createPipelines() {
			const bindings = createFixedInputBindings(device, inputSchema, params, context.resolution, 1, 'level0');
			try {
				const prefix = bindings.code + '\n' + commonCode + '\n' + colorCode + '\n';
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
		}

		const pipelines = createPipelines();
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
			cacheKey: 0,
			render({ commandEncoder }) {
				const sampleCount = clamp(Math.round(finiteOr(params.analysisSamples, 4096)), 1, 65536);
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
				const lightnessMatch = clamp(finiteOr(params.lightnessMatch, 0), 0, 1);
				const chromaMatch = clamp(finiteOr(params.chromaMatch, 1), 0, 1);
				uniformValues.set({ sampleCount, partialCount, lightnessMatch, chromaMatch, maximumGain: clamp(finiteOr(params.maximumGain, 4), 1, 16) });
				device.queue.writeBuffer(resources.uniformBuffer, 0, uniformValues.arrayBuffer);
				const inputGroup = pipelines.bindings.getBindGroup();
				if (lightnessMatch > 0 || chromaMatch > 0) {
					const compute = commandEncoder.beginComputePass();
					compute.setPipeline(pipelines.analyze);
					compute.setBindGroup(0, resources.analyzeGroup);
					compute.setBindGroup(1, inputGroup);
					compute.dispatchWorkgroups(partialCount);
					compute.setPipeline(buildTransform);
					compute.setBindGroup(0, resources.transformGroup);
					compute.dispatchWorkgroups(1);
					compute.end();
				}
				const output = beginOutputPass(commandEncoder, outputView);
				output.setPipeline(pipelines.output);
				output.setBindGroup(0, resources.outputGroup);
				output.setBindGroup(1, inputGroup);
				output.draw(3);
				output.end();
			},
			dispose: () => {
				resources?.dispose();
				pipelines.bindings.dispose();
			},
		};
	},
};

export default implementation;
