import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
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
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', radius: 'vector', rotation: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// 縦横の半径による画素ごとの早期return後もサンプリングするためLODを明示する。
			sampling: 'level0',
		});

		return {
			render: (ctx) => {
				uniformValues.set({
					aspectRatio: resolution.width / resolution.height,
					samples: ctx.params.samples,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const { input, radius, rotation } = ctx.params;
				const variant = pipelines.update({ input, radius, rotation }, ctx.outputDataMap.output.texture);
				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(variant.pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
