import seedrandom from 'seedrandom';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const maxTearings = 128;

export default implementEffect<typeof definition, 'shaderInput'>({
	inputMode: 'shaderInput',
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
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// 画素ごとに分岐するループ内・ループ後でも参照できるようLODを明示する。
			sampling: 'level0',
		});

		const shifts = new Float32Array(maxTearings * 4);

		return {
			render: (ctx) => {
				const amount = Math.min(maxTearings, Math.max(0, Math.trunc(ctx.params.amount)));
				const rnd = seedrandom(ctx.params.seed.toString());
				for (let i = 0; i < amount; i++) {
					const offset = i * 4;
					shifts[offset] = rnd();
					shifts[offset + 1] = (1 - rnd() * 2) * ctx.params.strength;
					shifts[offset + 2] = rnd() * (ctx.params.size / 100);
				}

				uniformValues.set({
					amount,
					angle: ctx.params.angle * Math.PI,
					channelShift: ctx.params.channelShift,
					shifts,
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(variant.pipeline);
				passEncoder.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				passEncoder.setBindGroup(0, bindGroup);
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
