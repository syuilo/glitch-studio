import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createSpectralSamples, SPECTRAL_SAMPLE_COUNT } from './spectral-samples.ts';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = `const SPECTRAL_SAMPLE_COUNT = ${SPECTRAL_SAMPLE_COUNT}u;\n` + shaderCode;

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
			schema: { input: 'scalar', incidenceAngle: 'scalar', lightColor: 'color', opacity: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				uniformValues.set({
					minimumThickness: Math.max(0, ctx.params.minimumThickness),
					maximumThickness: Math.max(0, ctx.params.maximumThickness),
					// 外側を空気とし、両屈折率を1以上にすることで全反射の複素位相を扱わずに済む。
					// 金属・吸収・波長による屈折率の分散は、この誘電体モデルには含めない。
					filmIor: Math.max(1, ctx.params.filmIor),
					substrateIor: Math.max(1, ctx.params.substrateIor),
					brightness: Math.max(0, ctx.params.brightness),
					transmission: ctx.params.mode === 'transmission' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({
					input: ctx.params.input,
					incidenceAngle: ctx.params.incidenceAngle,
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
