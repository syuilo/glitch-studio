import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import type definition from '@glitch/shared/fx-definitions/lcd.ts';
import { implementEffect } from '../../fx-implementation.ts';
import code from './shader.wgsl?raw';

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
		const sampler = wgpu.device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});

		let inputTexture = params.input;
		let bindGroup: GPUBindGroup;
		const updateBindGroup = () => {
			bindGroup = wgpu.device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 1, resource: { buffer: uniformBuffer } },
					{ binding: 2, resource: sampler },
					{ binding: 3, resource: (inputTexture ?? fallbackTexture).createView() },
				],
			});
		};
		updateBindGroup();

		const shortDimension = Math.min(resolution.width, resolution.height);

		return {
			render: (ctx) => {
				if (ctx.params.input !== inputTexture) {
					inputTexture = ctx.params.input;
					updateBindGroup();
				}

				const divisions = Math.min(200, Math.max(1, ctx.params.size));
				uniformValues.set({
					cellSize: [
						shortDimension / resolution.width / divisions,
						shortDimension / resolution.height / divisions,
					],
					border: Math.min(1, Math.max(0, ctx.params.border)),
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
