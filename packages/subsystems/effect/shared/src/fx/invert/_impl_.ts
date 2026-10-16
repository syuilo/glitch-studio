import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const uniformValues = new Uint32Array(3);
		const uniformBuffer = device.createBuffer({ size: uniformValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
		});
		return {
			render: ctx => {
				uniformValues[0] = ctx.params.red ? 1 : 0;
				uniformValues[1] = ctx.params.green ? 1 : 0;
				uniformValues[2] = ctx.params.blue ? 1 : 0;
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
