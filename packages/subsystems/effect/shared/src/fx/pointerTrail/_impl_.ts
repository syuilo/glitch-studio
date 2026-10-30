import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	needsPreviousFrame: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		scalar: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const shaderModule = wgpu.device.createShaderModule({
			code: code,
		});

		const shaderDataDefinitions = makeShaderDataDefinitions(code);

		const pipeline = wgpu.device.createRenderPipeline({
			vertex: {
				module: wgpu.defaultVertexShaderModule,
			},
			fragment: {
				module: shaderModule,
				targets: [
					{ format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float' },
					{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' },
				],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);

		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const bindGroups = new Map<GPUTextureView, GPUBindGroup>();

		return {
			render: (ctx) => {
				const previousVectorTextureView = ctx.outputDataMap.output.previousFrameTextureView!;
				const previousScalarTextureView = ctx.outputDataMap.scalar.previousFrameTextureView!;
				let bindGroup = bindGroups.get(previousVectorTextureView);

				if (bindGroup == null) {
					bindGroup = wgpu.device.createBindGroup({
						layout: pipeline.getBindGroupLayout(0),
						entries: [
							{ binding: 1, resource: { buffer: uniformBuffer } },
							{ binding: 2, resource: previousVectorTextureView },
							{ binding: 3, resource: previousScalarTextureView },
						],
					});
					bindGroups.set(previousVectorTextureView, bindGroup);
				}

				uniformValues.set({
					aspectRatio: resolution.width / resolution.height,
					timeDelta: ctx.timeDelta,
					radius: ctx.params.radius,
					strength: ctx.params.strength,
					halfLife: Math.max(1, ctx.params.halfLife),
					pointerPosition: [ctx.pointerPosition.x, ctx.pointerPosition.y],
					pointerVector: [ctx.pointerVector.x, ctx.pointerVector.y],
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [ctx.outputDataMap.output.textureView, ctx.outputDataMap.scalar.textureView].map(view => ({
						view,
						clearValue: [0, 0, 0, 0],
						loadOp: 'clear' as const,
						storeOp: 'store' as const,
					})),
				});
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose: () => {
				uniformBuffer.destroy();
			},
		};
	},
});
