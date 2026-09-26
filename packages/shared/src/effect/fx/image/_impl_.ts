import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	// 通常モードはレンダラーの解像度に従い、Originalだけ素材の解像度を使う。
	getOutputResolution: params => params.sizeMode === 'original' ? { width: params.image?.width ?? 1, height: params.image?.height ?? 1 } : undefined,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
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
					format: wgpu.intermediateTextureFormat,
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

		return {
			render: (ctx) => {
				if (ctx.params.image == null) {
					const pass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [{
						view: ctx.outputDataMap.output.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store',
					}] });
					pass.end();
					return;
				}
				// 初期化後のAsset選択・変更も描画に反映する。
				const sourceTexture = ctx.params.image;
				const bindGroup = wgpu.device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 1, resource: { buffer: uniformBuffer } },
						{ binding: 2, resource: sampler },
						{ binding: 3, resource: sourceTexture.createView() },
					],
				});
				uniformValues.set({
					aspectRatio: ctx.outputDataMap.output.texture.width / ctx.outputDataMap.output.texture.height,
					sourceAspectRatio: sourceTexture.width / sourceTexture.height,
					// 保存する選択肢名をシェーダーのモード番号へ変換する。
					mode: { stretch: 0, cover: 1, contain: 2, original: 3 }[ctx.params.sizeMode],
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
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
