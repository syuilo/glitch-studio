import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	getOutputResolution: params => ({ width: params.image?.width ?? 1, height: params.image?.height ?? 1 }),
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const pipeline = device.createRenderPipeline({
			layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code }), targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		let source: GPUTexture | null = null;
		let group: GPUBindGroup;
		return {
			render: ctx => {
				const image = ctx.params.image;
				if (image != null && source !== image) {
					source = image;
					group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: image.createView() }] });
				}
				const pass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [{
					view: ctx.outputDataMap.output.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store',
				}] });
				if (image != null) {
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, group);
					pass.draw(6);
				}
				pass.end();
			},
			dispose: () => { source = null; },
		};
	},
});
