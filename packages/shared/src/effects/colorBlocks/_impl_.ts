import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const shaderModule = wgpu.device.createShaderModule({ code });
		const pipeline = wgpu.device.createRenderPipeline({
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: {
				module: shaderModule,
				targets: [{ format: wgpu.intermediateTextureFormat }],
			},
			primitive: { topology: 'triangle-list' },
			layout: 'auto',
		});
		const shaderDataDefinitions = makeShaderDataDefinitions(code);
		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);
		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const bindGroup = wgpu.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 1, resource: { buffer: uniformBuffer } },
			],
		});

		const shortDimension = Math.min(resolution.width, resolution.height);
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

		return {
			render: (ctx) => {
				seedValue[0] = ctx.params.seed;
				const blockScaleX = 1 - Math.min(1, Math.max(0, ctx.params.size[0]));
				const blockScaleY = 1 - Math.min(1, Math.max(0, ctx.params.size[1]));
				uniformValues.set({
					cellSize: [
						Math.max(blockScaleX * shortDimension, 1) / resolution.width,
						Math.max(blockScaleY * shortDimension, 1) / resolution.height,
					],
					amount: Math.min(1, Math.max(0, ctx.params.amount / 100)),
					alphaRandomness: Math.min(1, Math.max(0, ctx.params.alphaRandomness)),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					rgb: ctx.params.rgb ? 1 : 0,
					cmy: ctx.params.cmy ? 1 : 0,
					black: ctx.params.black ? 1 : 0,
					white: ctx.params.white ? 1 : 0,
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
});
