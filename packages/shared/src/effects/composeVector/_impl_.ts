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
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const layout = device.createBindGroupLayout({ entries: [
			...[0, 1].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as const } })),
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code }), targets: [{ format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float' }] },
			primitive: { topology: 'triangle-list' },
		});
		let textures: GPUTexture[] = [];
		let bindGroup: GPUBindGroup;
		return {
			render: ctx => {
				const inputs = [ctx.params.x, ctx.params.y];
				if (inputs.some((texture, i) => texture !== textures[i])) {
					textures = inputs;
					bindGroup = device.createBindGroup({ layout, entries: [
						...textures.map((texture, binding) => ({ binding, resource: texture.createView() })),
						{ binding: 2, resource: sampler },
					] });
				}
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {},
		};
	},
});
