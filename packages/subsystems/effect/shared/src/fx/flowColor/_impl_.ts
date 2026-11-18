import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
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
	init: ({ wgpu: { device, defaultVertexShaderModule } }) => {
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code,
			schema: { background: 'color', vector: 'vector', intensity: 'scalar', opacity: 'scalar' },
			internalLayouts: [layout], targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }], sampling: 'level0',
		});
		return {
			render: ctx => {
				const { vectorScale, intensityScale, frequency, phase, channelPhase, brightness } = ctx.params;
				if (![vectorScale, intensityScale, frequency, phase, channelPhase, brightness].every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
					throw new Error('Flow Color requires finite coloring parameters.');
				}
				uniformValues.set({
					vectorScale, intensityScale: Math.max(0, intensityScale), frequency,
					// 大きなアニメーション時刻をf32に渡す前に一周へ戻し、色の位相の精度を維持する。
					phase: phase - Math.floor(phase), channelPhase: channelPhase - Math.floor(channelPhase),
					brightness: Math.max(0, brightness),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ background: ctx.params.background, vector: ctx.params.vector, intensity: ctx.params.intensity, opacity: ctx.params.opacity }, ctx.outputDataMap.output.texture);
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
