import type definition from '@glitch/shared/fx-definitions/transform.ts';
import { implementEffect } from '../../fx-implementation.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => ({
		output: wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	}),
	init: ({ wgpu, resolution, fallbackTexture }) => {
		const device = wgpu.device;
		// パラメータの32bitデータテクスチャもフィルタリング機能に依存せず読み取る。
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			...[1, 2, 3, 4].map(binding => ({
				binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' as const },
			})),
		] });
		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code }), targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformBuffer = device.createBuffer({ size: 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformData = new ArrayBuffer(8);
		new Float32Array(uniformData)[0] = resolution.width / resolution.height;
		const wrapModes = { transparent: 0, clampToEdge: 1, repeat: 2, repeatMirrored: 3 };
		let textures: GPUTexture[] = [];
		let bindGroup: GPUBindGroup;
		return {
			render: ctx => {
				const p = ctx.params;
				new Uint32Array(uniformData)[1] = wrapModes[p.wrap];
				device.queue.writeBuffer(uniformBuffer, 0, uniformData);
				const inputs = [p.input ?? fallbackTexture, p.translation, p.scale, p.rotation];
				if (inputs.some((texture, i) => texture !== textures[i])) {
					textures = inputs;
					bindGroup = device.createBindGroup({ layout, entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						...textures.map((texture, i) => ({ binding: i + 1, resource: texture.createView() })),
					] });
				}
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
});
