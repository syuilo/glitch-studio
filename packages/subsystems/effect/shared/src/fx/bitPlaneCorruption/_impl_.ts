import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const modes = { invert: 0, clear: 1, set: 2, swap: 3, randomize: 4 };
const patterns = { blocks: 0, horizontal: 1, vertical: 2, wholeImage: 3 };
const fitModes = { stretch: 0, cover: 1, contain: 2 };
const clampInteger = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution }) => {
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code,
			schema: { input: 'color', amount: 'scalar', probability: 'scalar', density: 'vector' },
			targets: [{ format: intermediateTextureFormat }],
			internalLayouts: [layout],
			// 透明画素や無加工の領域は早期returnするため、入力参照のLODを明示する。
			sampling: 'level0',
		});
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

		return {
			render: ctx => {
				const params = ctx.params;
				const bitDepth = clampInteger(params.bitDepth, 1, 16);
				const firstBit = clampInteger(params.firstBit, 0, bitDepth - 1);
				const lastBit = clampInteger(params.lastBit, 0, bitDepth - 1);
				seedValue[0] = params.seed;
				uniformValues.set({
					resolution: [resolution.width, resolution.height],
					fitMode: fitModes[params.fitMode],
					mode: modes[params.mode],
					pattern: patterns[params.pattern],
					bitDepth,
					firstBit: Math.min(firstBit, lastBit),
					lastBit: Math.max(firstBit, lastBit),
					channels: Number(params.red) | (Number(params.green) << 1) | (Number(params.blue) << 2),
					sharedErrors: Number(params.sharedErrors),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: params.input, amount: params.amount, probability: params.probability, density: params.density }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
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
