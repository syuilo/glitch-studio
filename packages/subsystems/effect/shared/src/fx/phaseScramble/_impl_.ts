import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createPhaseScrambleLayout, createPhaseScramblePasses } from './layout.ts';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import fourierDefinitionsCode from '../../fourier/definitions.wgsl?raw';
import fftCode from '../../fourier/transform.wgsl?raw';
import scrambleCode from './scramble.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { PhaseScrambleLayout } from './layout.ts';

const effectCommonCode = fourierDefinitionsCode + '\n' + commonCode;
const inputSchema = { input: 'color' } as const;
const finiteNumber = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution }) => {
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(effectCommonCode).uniforms.uniforms);
		const uniformSize = uniformValues.arrayBuffer.byteLength;
		const uniformStride = Math.ceil(uniformSize / device.limits.minUniformBufferOffsetAlignment) * device.limits.minUniformBufferOffsetAlignment;
		const computeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const outputLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
		const transform = device.createComputePipeline({ layout: computePipelineLayout, compute: { module: device.createShaderModule({ code: fourierDefinitionsCode + '\n' + fftCode }), entryPoint: 'transform' } });
		const scramble = device.createComputePipeline({ layout: computePipelineLayout, compute: { module: device.createShaderModule({ code: effectCommonCode + '\n' + scrambleCode }), entryPoint: 'scramble' } });
		const createVariant = (input: ShaderInput) => {
			const generated = generateShaderInputs(inputSchema, { input }, 1, 'level0');
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
		const getVariant = (input: ShaderInput) => {
			const key = shaderInputVariantKey(inputSchema, { input });
			let variant = variants.get(key);
			if (variant == null) {
				variant = createVariant(input);
				variants.set(key, variant);
			}
			return variant;
		};
		// Amount=0・定数入力はFFT用の大きなbufferを確保せず、同じ出力shaderで直接返す。
		const bypassUniform = device.createBuffer({ size: uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const bypassStorage = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE });
		const bypassGroup = device.createBindGroup({ layout: outputLayout, entries: [
			{ binding: 0, resource: { buffer: bypassUniform } }, { binding: 1, resource: { buffer: bypassStorage } },
		] });
		const createResources = (layout: PhaseScrambleLayout) => {
			const plan = createPhaseScramblePasses(layout);
			const uniformBytes = new Uint8Array(uniformStride * plan.passes.length);
			const uniformBuffer = device.createBuffer({ size: uniformBytes.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			const buffers = [0, 1].map(() => device.createBuffer({ size: layout.bufferBytes, usage: GPUBufferUsage.STORAGE }));
			const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer, size: uniformSize } };
			const dispose = () => {
				uniformBuffer.destroy();
				for (const buffer of buffers) buffer.destroy();
			};
			try {
				return {
					key: [layout.width, layout.height, layout.blockColumns, layout.blockRows].join(':'),
					plan, uniformBytes, uniformBuffer,
					computeGroups: buffers.map((buffer, index) => device.createBindGroup({ layout: computeLayout, entries: [uniformEntry,
						{ binding: 1, resource: { buffer } }, { binding: 2, resource: { buffer: buffers[1 - index] } },
					] })),
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
				const bypass = amount === 0 || params.input.kind === 'uniform';
				uniformValues.set({ resolution: [resolution.width, resolution.height], processingEnabled: Number(!bypass) });
				const variant = getVariant(params.input);
				const inputGroup = variant.bindings.update({ input: params.input }, ctx.outputDataMap.output.texture);
				let outputGroup = bypassGroup;
				if (bypass) {
					device.queue.writeBuffer(bypassUniform, 0, uniformValues.arrayBuffer);
				} else {
					const layout = createPhaseScrambleLayout(params, resolution, device.limits);
					const key = [layout.width, layout.height, layout.blockColumns, layout.blockRows].join(':');
					if (resources == null || resources.key !== key) {
						const next = createResources(layout);
						resources?.dispose();
						resources = next;
					}
					const lower = Math.max(0, finiteNumber(params.minFrequency, 2));
					const upper = Math.max(0, finiteNumber(params.maxFrequency, 64));
					const evolution = finiteNumber(params.evolution, 0);
					const evolutionStep = Math.floor(evolution);
					const seed = Math.fround(params.seed);
					uniformValues.set({
						transform: { transformSize: [layout.width, layout.height], logSize: layout.logSize },
						blockGrid: [layout.blockColumns, layout.blockRows], tileSize: layout.tileSize, frequencyScale: layout.frequencyScale,
						amount, minFrequency: Math.min(lower, upper), maxFrequency: Math.max(lower, upper), softness: Math.max(0, finiteNumber(params.softness, 2)),
						seed: Number.isFinite(seed) ? seed : 0,
						evolutionStep: ((evolutionStep % 4294967296) + 4294967296) % 4294967296,
						evolutionMix: evolution - evolutionStep,
						independentChannels: Number(params.channelMode === 'independent'), processing: Number(params.processing === 'blocks'), mirror: Number(params.boundary === 'mirror'),
					});
					for (let index = 0; index < resources.plan.passes.length; index++) {
						const pass = resources.plan.passes[index];
						uniformValues.set({ transform: { axis: pass.axis, span: pass.span, inverse: pass.inverse } });
						// 全段を別領域へ保存し、コマンド投入前のuniform更新で前の段を壊さない。
						resources.uniformBytes.set(new Uint8Array(uniformValues.arrayBuffer), index * uniformStride);
					}
					device.queue.writeBuffer(resources.uniformBuffer, 0, resources.uniformBytes);
					const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
					for (let index = 0; index < resources.plan.passes.length; index++) {
						const pass = resources.plan.passes[index];
						compute.setPipeline(pass.kind === 'capture' ? variant.capture : pass.kind === 'fft' ? transform : scramble);
						compute.setBindGroup(0, resources.computeGroups[pass.source], [index * uniformStride]);
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
