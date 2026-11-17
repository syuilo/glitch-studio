import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
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
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { inputs: { array: 'color' } },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const { inputs, direction, sizeReference } = ctx.params;
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const referenceLength = getSizeReferenceLength(sizeReference, output.texture);
				const vertical = direction === 'vertical';
				// 余白と間隔が領域を使い切った場合は画像寸法を0で止める。
				// 負の寸法による反転を防ぎ、入力1個ではGapを完全に無視する。
				const padding = Math.min(Math.min(width, height) / 2, Math.max(0, ctx.params.padding) * referenceLength);
				const innerWidth = Math.max(0, width - 2 * padding);
				const innerHeight = Math.max(0, height - 2 * padding);
				const axisLength = vertical ? innerHeight : innerWidth;
				const gap = inputs.length > 1 ? Math.min(axisLength / (inputs.length - 1), Math.max(0, ctx.params.gap) * referenceLength) : 0;
				const cellLength = Math.max(0, axisLength - Math.max(0, inputs.length - 1) * gap) / Math.max(1, inputs.length);
				const cellWidth = vertical ? innerWidth : cellLength;
				const cellHeight = vertical ? cellLength : innerHeight;
				uniformValues.set({ canvasSize: [width, height], cellSize: [cellWidth, cellHeight], padding, gap, vertical: Number(vertical) });
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ inputs }, output.texture, {
					// Fitは出力画面ではなく各画像を収める領域の縦横比を基準にする。
					// 面積0ではシェーダーが透明を返すため、Fit計算だけは0除算を避ける。
					inputs: { width: cellWidth > 0 ? cellWidth : 1, height: cellHeight > 0 ? cellHeight : 1 },
				});
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
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
