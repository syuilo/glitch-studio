// Adapted from Paper Design's Liquid Metal (Apache-2.0; see LICENSE).
// Modified for WebGPU and live node inputs; no uploaded-image or shape selector.
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import preprocessCode from './preprocess.wgsl?raw';
import type definition from '@glitch/shared/effect-definitions/liquidMetal.ts';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu, resolution, params, fallbackTexture }) => {
		const { device } = wgpu;
		const module = device.createShaderModule({ code });
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module, targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		const gradientFormat = wgpu.enableFloat32Filtering ? 'rgba32float' : 'rgba16float';
		const computeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: {} },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: gradientFormat } },
		] });
		const computeModule = device.createShaderModule({ code: preprocessCode.replace('rgba16float', gradientFormat) });
		const layout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
		const makeCompute = (entryPoint: string, constants?: Record<string, number>) => device.createComputePipeline({ layout, compute: { module: computeModule, entryPoint, constants } });
		const initialize = makeCompute('initialize');
		const red = makeCompute('solve', { parity: 0 });
		const black = makeCompute('solve', { parity: 1 });
		const findMaximum = makeCompute('findMaximum');
		const finish = makeCompute('finish');
		const maximum = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		let inputTexture: GPUTexture | null | undefined;
		let gradient: GPUTexture;
		let pixels: GPUBuffer;
		let computeGroup: GPUBindGroup;
		let renderGroup: GPUBindGroup;
		let width = 0;
		let height = 0;
		const updateInput = (input: GPUTexture | null) => {
			inputTexture = input;
			const source = input ?? fallbackTexture;
			// Always scale to working resolution for consistency, as in upstream.
			// Size to solve Poisson at (will upscale to original size).
			const scale = Math.min(512 / Math.min(source.width, source.height), device.limits.maxTextureDimension2D / Math.max(source.width, source.height));
			const nextWidth = Math.max(1, Math.round(source.width * scale));
			const nextHeight = Math.max(1, Math.round(source.height * scale));
			if (width !== nextWidth || height !== nextHeight) {
				gradient?.destroy();
				pixels?.destroy();
				width = nextWidth;
				height = nextHeight;
				gradient = device.createTexture({ size: [width, height], format: gradientFormat, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
				pixels = device.createBuffer({ size: width * height * 8, usage: GPUBufferUsage.STORAGE });
			}
			computeGroup = device.createBindGroup({ layout: computeLayout, entries: [
				{ binding: 0, resource: source.createView() },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: { buffer: pixels } },
				{ binding: 3, resource: { buffer: maximum } },
				{ binding: 4, resource: gradient.createView() },
			] });
			renderGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: source.createView() },
				{ binding: 3, resource: gradient.createView() },
			] });
		};
		updateInput(params.input);
		return {
			render: (ctx) => {
				if (ctx.params.input !== inputTexture) updateInput(ctx.params.input);
				const p = ctx.params;
				uniformValues.set({
					...p,
					resolution: [resolution.width, resolution.height],
					// Upstream frame is milliseconds. Explicit time makes seeking deterministic.
					time: p.time * p.speed + p.frame / 1000,
					repetition: Math.max(1, p.repetition),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				ctx.commandEncoder.clearBuffer(maximum);
				// Rebuild every frame: animated nodes can change without changing textures.
				// No history or CPU readback; seeking always reproduces the same gradient.
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				compute.setBindGroup(0, computeGroup);
				const dispatch = (step: GPUComputePipeline) => {
					compute.setPipeline(step);
					compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
				};
				dispatch(initialize);
				// SOR converges ~2-20x faster than standard Gauss-Seidel.
				for (let i = 0; i < 40; i++) {
					dispatch(red);
					dispatch(black);
				}
				dispatch(findMaximum);
				dispatch(finish);
				compute.end();
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, renderGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				uniformBuffer.destroy();
				maximum.destroy();
				pixels.destroy();
				gradient.destroy();
			},
		};
	},
});
