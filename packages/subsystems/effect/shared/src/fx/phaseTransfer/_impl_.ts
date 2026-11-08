import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createPhaseTransferLayout, createPhaseTransferPasses } from './layout.ts';
import fourierDefinitionsCode from '../../fourier/definitions.wgsl?raw';
import fftCode from '../../fourier/transform.wgsl?raw';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import transferCode from './transfer.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { FourierImageLayout } from '../../fourier/layout.ts';

const effectCommonCode = fourierDefinitionsCode + '\n' + commonCode;
const inputSchema = { input: 'color', reference: 'color' } as const;
type Inputs = { input: ShaderInput; reference: ShaderInput };
const finiteNumber = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution }) => {
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(effectCommonCode).uniforms.uniforms);
		const uniformSize = uniformValues.arrayBuffer.byteLength;
		const uniformStride = Math.ceil(uniformSize / device.limits.minUniformBufferOffsetAlignment) * device.limits.minUniformBufferOffsetAlignment;
		const computeEntries: GPUBindGroupLayoutEntry[] = [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		];
		const computeLayout = device.createBindGroupLayout({ entries: computeEntries });
		const transferLayout = device.createBindGroupLayout({ entries: [...computeEntries, { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }] });
		const outputLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const transform = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
			compute: { module: device.createShaderModule({ code: fourierDefinitionsCode + '\n' + fftCode }), entryPoint: 'transform' },
		});
		const transfer = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [transferLayout] }),
			compute: { module: device.createShaderModule({ code: effectCommonCode + '\n' + transferCode }), entryPoint: 'transfer' },
		});
		const createVariant = (inputs: Inputs) => {
			const generated = generateShaderInputs(inputSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + effectCommonCode + '\n';
				return {
					bindings,
					capture: device.createComputePipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
						compute: { module: device.createShaderModule({ code: prefix + captureCode }), entryPoint: 'capture' },
					}),
					output: device.createRenderPipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
						vertex: { module: defaultVertexShaderModule },
						fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
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
		const bypassUniform = device.createBuffer({ size: uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const bypassStorage = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE });
		const bypassGroup = device.createBindGroup({ layout: outputLayout, entries: [
			{ binding: 0, resource: { buffer: bypassUniform } }, { binding: 1, resource: { buffer: bypassStorage } },
		] });
		const createResources = (layout: FourierImageLayout) => {
			const plan = createPhaseTransferPasses(layout);
			const transferPass = plan.passes.find(pass => pass.kind === 'transfer');
			if (transferPass == null) throw new Error('Phase Transfer: missing spectrum transfer pass.');
			const uniformBytes = new Uint8Array(uniformStride * plan.passes.length);
			const uniformBuffer = device.createBuffer({ size: uniformBytes.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			const buffers = [0, 1, 2].map(() => device.createBuffer({ size: layout.bufferBytes, usage: GPUBufferUsage.STORAGE }));
			const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer, size: uniformSize } };
			const dispose = () => {
				uniformBuffer.destroy();
				for (const buffer of buffers) buffer.destroy();
			};
			try {
				const computeGroups = new Map<number, GPUBindGroup>();
				for (let source = 0; source < 3; source++) {
					for (let destination = 0; destination < 3; destination++) {
						if (source === destination) continue;
						computeGroups.set(source * 3 + destination, device.createBindGroup({ layout: computeLayout, entries: [uniformEntry,
							{ binding: 1, resource: { buffer: buffers[source] } }, { binding: 2, resource: { buffer: buffers[destination] } },
						] }));
					}
				}
				return {
					key: [layout.width, layout.height, layout.blockColumns, layout.blockRows].join(':'),
					plan, uniformBytes, uniformBuffer, computeGroups,
					transferGroup: device.createBindGroup({ layout: transferLayout, entries: [uniformEntry,
						{ binding: 1, resource: { buffer: buffers[transferPass.source] } },
						{ binding: 2, resource: { buffer: buffers[transferPass.destination] } },
						{ binding: 3, resource: { buffer: buffers[transferPass.reference] } },
					] }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries: [uniformEntry, { binding: 1, resource: { buffer: buffers[plan.outputBuffer] } }] }),
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
				const params = ctx.params;
				const amount = Math.min(1, Math.max(0, finiteNumber(params.amount, 0.5)));
				// 空間的に一定な主入力は移せる非DC成分がなく、一定な副入力は位相を
				// 決める非DC成分がない。未接続の透明なReferenceも元画像のまま返す。
				const bypass = amount === 0 || params.input.kind === 'uniform' || params.reference.kind === 'uniform';
				uniformValues.set({ resolution: [resolution.width, resolution.height], processingEnabled: Number(!bypass) });
				const inputs = { input: params.input, reference: params.reference };
				const variant = getVariant(inputs);
				const inputGroup = variant.bindings.update(inputs, ctx.outputDataMap.output.texture);
				let outputGroup = bypassGroup;
				if (bypass) {
					device.queue.writeBuffer(bypassUniform, 0, uniformValues.arrayBuffer);
				} else {
					const layout = createPhaseTransferLayout(params, resolution, device.limits);
					const key = [layout.width, layout.height, layout.blockColumns, layout.blockRows].join(':');
					if (resources == null || resources.key !== key) {
						const next = createResources(layout);
						resources?.dispose();
						resources = next;
					}
					const lower = Math.max(0, finiteNumber(params.minFrequency, 2));
					const upper = Math.max(0, finiteNumber(params.maxFrequency, 64));
					uniformValues.set({
						transform: { transformSize: [layout.width, layout.height], logSize: layout.logSize },
						blockGrid: [layout.blockColumns, layout.blockRows], tileSize: layout.tileSize, frequencyScale: layout.frequencyScale,
						amount, minFrequency: Math.min(lower, upper), maxFrequency: Math.max(lower, upper), softness: Math.max(0, finiteNumber(params.softness, 2)),
						phaseThreshold: Math.max(0, finiteNumber(params.phaseThreshold, 0.00001)),
						independentChannels: Number(params.channelMode === 'independent'), processing: Number(params.processing === 'blocks'), mirror: Number(params.boundary === 'mirror'),
					});
					for (let index = 0; index < resources.plan.passes.length; index++) {
						const pass = resources.plan.passes[index];
						uniformValues.set({
							transform: { axis: pass.kind === 'fft' ? pass.axis : 0, span: pass.kind === 'fft' ? pass.span : 0, inverse: pass.kind === 'fft' ? pass.inverse : 0 },
							referenceInput: Number(pass.kind === 'capture' && pass.referenceInput),
						});
						resources.uniformBytes.set(new Uint8Array(uniformValues.arrayBuffer), index * uniformStride);
					}
					device.queue.writeBuffer(resources.uniformBuffer, 0, resources.uniformBytes);
					const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
					for (let index = 0; index < resources.plan.passes.length; index++) {
						const pass = resources.plan.passes[index];
						const group = pass.kind === 'transfer' ? resources.transferGroup : resources.computeGroups.get(pass.source * 3 + pass.destination);
						if (group == null) throw new Error('Phase Transfer: missing FFT buffer pair.');
						compute.setPipeline(pass.kind === 'capture' ? variant.capture : pass.kind === 'fft' ? transform : transfer);
						compute.setBindGroup(0, group, [index * uniformStride]);
						if (pass.kind === 'capture') compute.setBindGroup(1, inputGroup);
						compute.dispatchWorkgroups(Math.ceil(layout.width / 8), Math.ceil(layout.height / 8), layout.blockCount);
					}
					compute.end();
					outputGroup = resources.outputGroup;
				}
				const output = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				output.setPipeline(variant.output);
				output.setBindGroup(0, outputGroup);
				output.setBindGroup(1, inputGroup);
				output.draw(3);
				output.end();
			},
			dispose: () => {
				resources?.dispose();
				for (const variant of variants.values()) variant.bindings.dispose();
				bypassUniform.destroy();
				bypassStorage.destroy();
			},
		};
	},
});
