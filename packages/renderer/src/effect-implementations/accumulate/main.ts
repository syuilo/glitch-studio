import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/effect-definitions/accumulate.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	needsPreviousFrame: true,
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enableFloat32Filtering ? 'rgba32float' : 'rgba16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, enableFloat32Filtering }, params, fallbackTexture }) => {
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const module = device.createShaderModule({ code });
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			],
		});
		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: {
				module,
				constants: { MAX_VALUE: enableFloat32Filtering ? 3.402823466e38 : 65504 },
				targets: [{ format: enableFloat32Filtering ? 'rgba32float' : 'rgba16float' }],
			},
			primitive: { topology: 'triangle-list' },
		});
		const values = new Float32Array(2);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		let input = params.input;
		let hasPrevious = false;
		const groups = new Map<GPUTextureView, GPUBindGroup>();
		return {
			render: ctx => {
				if (input !== ctx.params.input) {
					input = ctx.params.input;
					groups.clear();
				}
				const previous = ctx.outputDataMap.output.previousFrameTextureView!;
				let group = groups.get(previous);
				if (group == null) {
					group = device.createBindGroup({
						layout,
						entries: [
							{ binding: 0, resource: { buffer: uniforms } },
							{ binding: 1, resource: (input ?? fallbackTexture).createView() },
							{ binding: 2, resource: previous },
							{ binding: 3, resource: sampler },
						],
					});
					groups.set(previous, group);
				}
				const seconds = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				const halfLife = Math.max(0, ctx.params.halfLife) / 1000;
				const rate = halfLife > 0 ? Math.LN2 / halfLife : 0;
				const decay = Math.exp(-rate * seconds);
				// Exact integration of dA/dt = strength * input - rate * A for constant input.
				// expm1 preserves precision when the frame interval is small relative to the half-life.
				const integration = rate > 0 ? -Math.expm1(-rate * seconds) / rate : seconds;
				values[0] = hasPrevious && !ctx.params.reset ? decay : 0;
				values[1] = input != null && !ctx.params.reset ? integration * Math.max(0, ctx.params.strength) : 0;
				device.queue.writeBuffer(uniforms, 0, values);
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				render.setPipeline(pipeline);
				render.setBindGroup(0, group);
				render.draw(6);
				render.end();
				hasPrevious = true;
			},
			dispose: () => {
				uniforms.destroy();
				groups.clear();
			},
		};
	},
});
