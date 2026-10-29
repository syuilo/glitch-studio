import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const { device } = wgpu;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'scalar' }, sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' }],
		});
		return {
			render: ctx => {
				const input = ctx.params.input;
				const output = ctx.outputDataMap.output.texture;
				const transparent = input.kind === 'texture' && input.wrapMode === 'transparent';
				// 通常のtransparent入力は数値0を混ぜるが、SDFの0は背景ではなく境界を表す。
				// 距離は端を延長して読み、元の透明領域は変換後のマスクへ適用する。
				const distanceInput = transparent ? { ...input, wrapMode: 'clamp' as const } : input;
				uniformValues.set({
					inputScale: transparent ? inputUvScale(input.texture, output, input.fitMode) : [1, 1],
					inputSize: transparent ? [input.texture.width, input.texture.height] : [1, 1],
					transparentInput: transparent ? 1 : 0,
					nearestInput: transparent && input.filterMode === 'nearest' ? 1 : 0,
					offset: ctx.params.offset,
					strokeWidth: Math.max(0, ctx.params.strokeWidth),
					feather: Math.max(0, ctx.params.feather),
					mode: ctx.params.mode === 'fill' ? 0 : 1,
					strokeAlignment: { inside: 0, center: 1, outside: 2 }[ctx.params.strokeAlignment],
					antiAlias: ctx.params.antiAlias ? 1 : 0,
					invert: ctx.params.invert ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: distanceInput }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); uniformBuffer.destroy(); },
		};
	},
});
