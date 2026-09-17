import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => ({
		output: wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	}),
	init: ({ wgpu, resolution, fallbackTexture }) => {
		const device = wgpu.device;
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code }), targets: [{ format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float' }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		let texture: GPUTexture | undefined;
		let bindGroup: GPUBindGroup;
		return {
			render: ctx => {
				const input = ctx.params.input ?? fallbackTexture;
				if (input !== texture) {
					texture = input;
					bindGroup = device.createBindGroup({ layout, entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						{ binding: 1, resource: input.createView() },
						{ binding: 2, resource: sampler },
					] });
				}
				uniformValues.set({ aspectRatio: resolution.width / resolution.height, strength: ctx.params.strength, normalize: ctx.params.normalize ? 1 : 0 });
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { uniformBuffer.destroy(); },
		};
	},
});
