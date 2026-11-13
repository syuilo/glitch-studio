import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createSpectralSamples } from '../../optics/spectral-samples.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
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
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const spectralSamples = createSpectralSamples();
		const spectralBuffer = device.createBuffer({ size: spectralSamples.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(spectralBuffer, 0, spectralSamples);
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const group = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: spectralBuffer } },
		] });
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { input: 'scalar', birefringence: 'scalar', fastAxisAngle: 'scalar', lightColor: 'color', opacity: 'scalar' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				uniformValues.set({
					minimumThickness: Math.max(0, ctx.params.minimumThickness),
					maximumThickness: Math.max(0, ctx.params.maximumThickness),
					// 軸は半回転で元に戻る。大きなturn値をそのまま三角関数へ渡さない。
					polarizerAngle: (ctx.params.polarizerAngle % 0.5) * 2 * Math.PI,
					analyzerAngle: (ctx.params.analyzerAngle % 0.5) * 2 * Math.PI,
					brightness: Math.max(0, ctx.params.brightness),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({
					input: ctx.params.input,
					birefringence: ctx.params.birefringence,
					fastAxisAngle: ctx.params.fastAxisAngle,
					lightColor: ctx.params.lightColor,
					opacity: ctx.params.opacity,
				}, ctx.outputDataMap.output.texture);
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
				spectralBuffer.destroy();
			},
		};
	},
});
