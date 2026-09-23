import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
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
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		const shortDimension = Math.min(resolution.width, resolution.height);
		return {
			render: ctx => {
				// Sizeは短辺に対する割合。0でも解像度に依存しない下限でゼロ除算を防ぐ。
				const sizeX = Math.min(1, Math.max(0.0001, ctx.params.size[0]));
				const sizeY = Math.min(1, Math.max(0.0001, ctx.params.size[1]));
				seedValue[0] = ctx.params.seed;
				uniformValues.set({
					cellSize: [
						// 座標の全幅は2。短辺基準の分割を他のブロック系のcontainと揃え、
						// 1画素の下限による解像度依存を避ける。
						2 * (shortDimension / resolution.width) * sizeX,
						2 * (shortDimension / resolution.height) * sizeY,
					],
					amount: Math.min(1, Math.max(0, ctx.params.amount / 100)),
					alphaRandomness: Math.min(1, Math.max(0, ctx.params.alphaRandomness)),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					rgb: ctx.params.rgb ? 1 : 0,
					cmy: ctx.params.cmy ? 1 : 0,
					black: ctx.params.black ? 1 : 0,
					white: ctx.params.white ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
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
