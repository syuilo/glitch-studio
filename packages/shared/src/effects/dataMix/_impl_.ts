import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const fitModes = { stretch: 0, cover: 1, contain: 2 };

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'rgba32float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, fallbackTexture }) => {
		const device = wgpu.device;
		const values = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const buffer = device.createBuffer({ size: values.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			...[1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as const } })),
		] });
		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code }), targets: [{ format: wgpu.enable32bitDataTextures ? 'rgba32float' : 'rgba16float' }] },
			primitive: { topology: 'triangle-list' },
		});
		let textures: GPUTexture[] = [];
		let bindGroup: GPUBindGroup;
		return {
			render: ctx => {
				const p = ctx.params;
				const inputs = [p.inputA ?? fallbackTexture, p.inputB ?? fallbackTexture, p.amount];
				if (inputs.some((texture, i) => texture !== textures[i])) {
					textures = inputs;
					bindGroup = device.createBindGroup({ layout, entries: [
						{ binding: 4, resource: sampler },
						{ binding: 0, resource: { buffer } },
						...textures.map((texture, i) => ({ binding: i + 1, resource: texture.createView() })),
					] });
				}
				values.set({
					aspectRatio: resolution.width / resolution.height,
					fitA: fitModes[p.fitModeA], fitB: fitModes[p.fitModeB], fitAmount: fitModes[p.fitModeAmount],
				});
				device.queue.writeBuffer(buffer, 0, values.arrayBuffer);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => buffer.destroy(),
		};
	},
});
