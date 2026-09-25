import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

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
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { background: 'color', angle: 'scalar', size: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
		});
		return {
			render: ctx => {
				const output = ctx.outputDataMap.output.texture;
				const shortDimension = Math.min(output.width, output.height);
				// Checkerと同じく回転後のローカルX軸に周期を配置する。
				// StripeはX方向のみ繰り返すため、stretchの基準は画面幅になる。
				const extent = ctx.params.fitMode === 'stretch' ? output.width
					: ctx.params.fitMode === 'cover' ? Math.max(output.width, output.height) : shortDimension;
				uniformValues.set({
					aspect: [output.width / shortDimension, output.height / shortDimension],
					sizeScale: extent / shortDimension,
					pixelSize: 1 / shortDimension,
					threshold: Math.min(1, Math.max(0, ctx.params.threshold)),
					color: ctx.params.color,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ background: ctx.params.background, angle: ctx.params.angle, size: ctx.params.size }, output);
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
