import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.intermediateTextureFormat,
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
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// 歪んだ座標と分岐内で複数回参照するため、導関数に依存しないLOD 0で読む。
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const output = ctx.outputDataMap.output.texture;
				uniformValues.set({
					// レンズは出力領域を基準にする。入力自身の比率とfitはread_inputへ任せる。
					aspectRatio: output.width / output.height,
					angle: ctx.params.angle * Math.PI,
					spread: Math.max(0, Math.min(1, ctx.params.spread)),
					bias: Math.max(-1, Math.min(1, ctx.params.bias)),
					perspective: Math.max(0, Math.min(1, ctx.params.perspective)),
					count: Math.max(2, Math.min(50, Math.floor(ctx.params.count))),
					dispersion: Math.max(0, Math.min(1, ctx.params.dispersion)),
					dispersionShift: Math.max(-1, Math.min(1, ctx.params.dispersionShift)),
					dispersionColor: Math.max(0, Math.min(1, ctx.params.dispersionColor)),
					focusCenter: Math.max(0, Math.min(1, ctx.params.focusCenter)),
					focusEdges: Math.max(0, Math.min(1, ctx.params.focusEdges)),
					swirl: Math.max(-1, Math.min(1, ctx.params.swirl)),
					lensBulge: Math.max(-1, Math.min(1, ctx.params.lensBulge)),
					lensCircle: Math.max(0, Math.min(1, ctx.params.lensCircle)),
					grainMixer: Math.max(0, Math.min(1, ctx.params.grainMixer)),
					grainOverlay: Math.max(0, Math.min(1, ctx.params.grainOverlay)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: ctx.params.input }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
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
