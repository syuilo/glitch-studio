import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const fitModes = { stretch: 0, cover: 1, contain: 2 };

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
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', size: 'vector', rotation: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// ブロック境界や空間的に変化するパラメータで参照座標が不連続になるため、LODを固定する。
			sampling: 'level0',
		});

		return {
			render: (ctx) => {
				const output = ctx.outputDataMap.output;
				// 式からの小数・範囲外の値も、有限の正のサンプル数に揃える。
				const samples = Number.isFinite(ctx.params.samples) ? Math.min(256, Math.max(1, Math.round(ctx.params.samples))) : 1;
				uniformValues.set({
					resolution: [output.texture.width, output.texture.height],
					fitMode: fitModes[ctx.params.fitMode],
					samples,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const { input, size, rotation } = ctx.params;
				const variant = pipelines.update({ input, size, rotation }, output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
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
