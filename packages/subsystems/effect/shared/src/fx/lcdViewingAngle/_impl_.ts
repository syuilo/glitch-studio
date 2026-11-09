import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
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
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code: colorSpaceShaderCode + '\n' + code,
			schema: { input: 'color', horizontalViewingAngle: 'scalar', verticalViewingAngle: 'scalar', amount: 'scalar' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				uniformValues.set({
					colorShift: Math.min(1, Math.max(0, ctx.params.colorShift)),
					contrastLoss: Math.min(1, Math.max(0, ctx.params.contrastLoss)),
					inversion: Math.min(1, Math.max(0, ctx.params.inversion)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const output = ctx.outputDataMap.output.texture;
				const variant = pipelines.update({
					input: ctx.params.input,
					horizontalViewingAngle: ctx.params.horizontalViewingAngle,
					verticalViewingAngle: ctx.params.verticalViewingAngle,
					amount: ctx.params.amount,
				}, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
