import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resources }) => {
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
				targets: [{
					format: INTERMEDIATE_TEXTURE_FORMAT,
				}],
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

		const sampler = wgpu.device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'linear',
			addressModeU: 'mirror-repeat',
			addressModeV: 'mirror-repeat',
			addressModeW: 'mirror-repeat',
		});
		let sourceTexture: GPUTexture | null = null;
		let bindGroup: GPUBindGroup | null = null;

		return {
			render: (ctx) => {
				const image = resources.player?.getVideoTexture();
				if (image == null) {
					// フレーム削除後に以前の映像がキャッシュとして残らないよう透明にする。
					ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [{
							view: ctx.outputDataMap.output.textureView,
							clearValue: {
								r: 0,
								g: 0,
								b: 0,
								a: 0,
							},
							loadOp: 'clear',
							storeOp: 'store',
						}],
					}).end();
					return;
				}
				if (bindGroup == null || sourceTexture !== image.texture) {
					sourceTexture = image.texture;
					bindGroup = wgpu.device.createBindGroup({
						layout: pipeline.getBindGroupLayout(0),
						entries: [
							{ binding: 1, resource: { buffer: uniformBuffer } },
							{ binding: 2, resource: sampler },
							{ binding: 3, resource: image.texture.createView() },
						],
					});
				}

				uniformValues.set({
					aspectRatio: ctx.outputDataMap.output.texture.width / ctx.outputDataMap.output.texture.height,
					sourceAspectRatio: image.displayResolution.width / image.displayResolution.height,
					// 保存する選択肢名をシェーダーのモード番号へ変換する。
					mode: { stretch: 0, cover: 1, contain: 2 }[ctx.params.fit],
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(3);
				passEncoder.end();
			},
			dispose: () => {
				uniformBuffer.destroy();
			},
		};
	},
});
