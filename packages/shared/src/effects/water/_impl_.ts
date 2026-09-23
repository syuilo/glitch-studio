// Adapted from Paper Design's Water (Apache-2.0; see LICENSE).
// Modified for WebGPU node inputs, without background or image layout controls.
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';

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
			schema: { input: 'color' }, targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout], sampling: 'level0',
		});
		return {
			render: (ctx) => {
				const p = ctx.params;
				uniformValues.set({
					...p,
					// 入力のfitとは独立に、出力空間で水面模様の縦横の単位を揃える。
					aspectRatio: resolution.width / resolution.height,
					colorHighlight: [...p.colorHighlight, p.colorHighlightAlpha],
					// Upstream frame is milliseconds; explicit time supports deterministic seeking.
					time: p.time * p.speed + p.frame / 1000,
					size: Math.max(0.01, p.size),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); uniformBuffer.destroy(); },
		};
	},
});
