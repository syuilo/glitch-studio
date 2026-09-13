import { implementEffect } from '../../fx-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/fx-definitions/remap.ts';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => ({
		output: wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enableFloat32Filtering ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	}),
	init: ({ wgpu, fallbackTexture }) => {
		const device = wgpu.device;
		// textureLoadを使い、float32-filterable非対応でも32bitの入力を受け取る。
		const layout = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4].map(binding => ({
			binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' as const },
		})) });
		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code }), targets: [{ format: wgpu.enableFloat32Filtering ? 'r32float' : 'r16float' }] },
			primitive: { topology: 'triangle-list' },
		});
		let textures: GPUTexture[] = [];
		let bindGroup: GPUBindGroup;
		return {
			render: ctx => {
				const p = ctx.params;
				const inputs = [p.input ?? fallbackTexture, p.inMin, p.inMax, p.outMin, p.outMax];
				if (inputs.some((texture, i) => texture !== textures[i])) {
					textures = inputs;
					bindGroup = device.createBindGroup({ layout, entries: textures.map((texture, binding) => ({
						binding, resource: texture.createView(),
					})) });
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
