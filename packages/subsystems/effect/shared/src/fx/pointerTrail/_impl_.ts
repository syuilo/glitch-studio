import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
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
		const longDimension = Math.max(resolution.width, resolution.height);
		const isotropicVectorOutputScale = [resolution.width / longDimension, resolution.height / longDimension] as const;
		// 出力テクスチャを履歴にも使うため、前回の出力単位を記録する。
		// 初回の履歴は0なので、Screenとして扱っても換算結果は変わらない。
		let previousVectorOutputScale: readonly [number, number] = [1, 1];

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

				const vectorOutputScale = ctx.params.vectorCoordinateSystem === 'isotropic' ? isotropicVectorOutputScale : [1, 1] as const;
				uniformValues.set({
					aspectRatio: resolution.width / resolution.height,
					timeDelta: ctx.timeDelta,
					radius: 2 * ctx.params.radius * getSizeReferenceLength(ctx.params.sizeReference, resolution) / longDimension,
					strength: ctx.params.strength,
					halfLife: Math.max(1, ctx.params.halfLife),
					pointerPosition: [ctx.pointerPosition.x, ctx.pointerPosition.y],
					pointerVector: [ctx.pointerVector.x, ctx.pointerVector.y],
					vectorOutputScale,
					vectorHistoryScale: [vectorOutputScale[0] / previousVectorOutputScale[0], vectorOutputScale[1] / previousVectorOutputScale[1]],
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
				previousVectorOutputScale = vectorOutputScale;
			},
			dispose: () => {
				uniformBuffer.destroy();
			},
		};
	},
});
