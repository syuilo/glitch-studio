import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, never, typeof definition.staticSettingDefs> = {
	async init(context) {
		const { device, defaultVertexShaderModule, resolution, inputs, resources } = context;
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: [{ view: context.outputTextures.get('output')!.createView(), loadOp: 'clear', storeOp: 'store' }],
		};
		const shaderModule = device.createShaderModule({
			code,
		});

		const pipeline = await device.createRenderPipelineAsync({
			vertex: {
				module: defaultVertexShaderModule,
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

		const uniformValues = createShaderBuffer(codeUniforms.uniforms);

		const uniformBuffer = device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const sampler = device.createSampler({
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
					ctx.commandEncoder.beginRenderPass(descriptor).end();
					return;
				}
				if (bindGroup == null || sourceTexture !== image.texture) {
					sourceTexture = image.texture;
					bindGroup = device.createBindGroup({
						layout: pipeline.getBindGroupLayout(0),
						entries: [
							{ binding: 1, resource: { buffer: uniformBuffer } },
							{ binding: 2, resource: sampler },
							{ binding: 3, resource: image.texture.createView() },
						],
					});
				}

				uniformValues.set({
					aspectRatio: resolution.width / resolution.height,
					sourceAspectRatio: image.displayResolution.width / image.displayResolution.height,
					// 保存する選択肢名をシェーダーのモード番号へ変換する。
					mode: { stretch: 0, cover: 1, contain: 2 }[inputs.fit.value],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.commandEncoder.beginRenderPass(descriptor);
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
};

export default implementation;
