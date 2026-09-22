import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const fitModes = { stretch: 0, cover: 1, contain: 2 };

export default implementEffect<typeof definition, 'shaderInput'>({
	inputMode: 'shaderInput',
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
			schema: { input: 'color', size: 'vector' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// タイルごとの分岐・早期returnからも入力を読むためLODを明示する。
			sampling: 'level0',
		});

		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

		return {
			render: (ctx) => {
				seedValue[0] = ctx.params.seed;
				uniformValues.set({
					resolution: [resolution.width, resolution.height],
					fitMode: fitModes[ctx.params.fitMode],
					randomSwap: ctx.params.randomSwap ? 1 : 0,
					randomRotation: ctx.params.randomRotation ? 1 : 0,
					randomFlipX: ctx.params.randomFlipX ? 1 : 0,
					randomFlipY: ctx.params.randomFlipY ? 1 : 0,
					amount: Math.min(1, Math.max(0, ctx.params.amount)),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const variant = pipelines.update({ input: ctx.params.input, size: ctx.params.size }, ctx.outputDataMap.output.texture);
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
