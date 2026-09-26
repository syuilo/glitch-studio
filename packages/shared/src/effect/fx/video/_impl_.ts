import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	// Originalは符号化領域ではなく、表示するフレームの解像度を使う。
	// フレーム未取得時はImageと同様に1x1とし、取得後や解像度変更時に追従する。
	getOutputResolution: params => params.sizeMode === 'original' ? {
		width: params.player?.videoFrame?.displayWidth ?? 1,
		height: params.player?.videoFrame?.displayHeight ?? 1,
	} : undefined,
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
				const frame = ctx.params.player?.videoFrame;
				if (!frame) {
					// フレーム削除後に以前の映像がキャッシュとして残らないよう透明にする。
					ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [{
							view: ctx.outputDataMap.output.textureView,
							clearValue: { r: 0, g: 0, b: 0, a: 0 },
							loadOp: 'clear',
							storeOp: 'store',
						}],
					}).end();
					return;
				}
				const freshTex = wgpu.device.importExternalTexture(
					{ source: frame },
				);
				const bindGroup = wgpu.device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 1, resource: { buffer: uniformBuffer } },
						{ binding: 2, resource: sampler },
						{ binding: 3, resource: freshTex },
					],
				});

				uniformValues.set({
					aspectRatio: ctx.outputDataMap.output.texture.width / ctx.outputDataMap.output.texture.height,
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
