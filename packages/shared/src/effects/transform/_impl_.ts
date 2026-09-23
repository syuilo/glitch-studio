import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition, 'shaderInput'>({
	inputMode: 'shaderInput',
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformBuffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([resolution.width / resolution.height]));
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', translation: 'vector', scale: 'vector', rotation: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			// Scaleによる画素ごとの早期return後にも入力を読むため、微分不要のlevel0を使う。
			internalLayouts: [layout], sampling: 'level0',
		});
		return {
			render: ctx => {
				const { input, translation, scale, rotation } = ctx.params;
				const variant = pipelines.update({ input, translation, scale, rotation }, ctx.outputDataMap.output.texture);
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
