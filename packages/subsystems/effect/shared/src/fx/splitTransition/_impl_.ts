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
			schema: { inputA: 'color', inputB: 'color' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const { inputA, inputB, direction, reverse, sizeReference } = ctx.params;
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const vertical = direction === 'vertical';
				const axisLength = vertical ? height : width;
				const referenceLength = getSizeReferenceLength(sizeReference, output.texture);
				const gap = Math.min(axisLength, Math.max(0, ctx.params.gap) * referenceLength);
				const progress = Math.min(1, Math.max(0, ctx.params.progress));
				// Gapを確保してから残り幅を按分すると、進捗の端点にも余白が残る。
				// 透明帯全体が画面外へ抜ける距離だけ移動させ、端点でA/Bを全面に配置する。
				const regionLengthA = Math.max(0, axisLength - progress * (axisLength + gap));
				const regionLengthB = Math.max(0, progress * (axisLength + gap) - gap);
				const regionSizeA = { width: vertical ? width : regionLengthA, height: vertical ? regionLengthA : height };
				const regionSizeB = { width: vertical ? width : regionLengthB, height: vertical ? regionLengthB : height };
				// Reverseは配置先だけを変更する。参照座標を反転すると画像自体も鏡像になる。
				const offsetA = reverse ? axisLength - regionLengthA : 0;
				const offsetB = reverse ? 0 : axisLength - regionLengthB;
				uniformValues.set({
					regionSizeA: [regionSizeA.width, regionSizeA.height],
					regionSizeB: [regionSizeB.width, regionSizeB.height],
					regionOffsetA: vertical ? [0, offsetA] : [offsetA, 0],
					regionOffsetB: vertical ? [0, offsetB] : [offsetB, 0],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ inputA, inputB }, output.texture, {
					// A/Bそれぞれの領域寸法でFitする。面積0はシェーダーで読み飛ばすため、
					// Fit計算だけは正の寸法を渡して0除算を避ける。端数のある領域は丸めない。
					inputA: { width: regionSizeA.width > 0 ? regionSizeA.width : 1, height: regionSizeA.height > 0 ? regionSizeA.height : 1 },
					inputB: { width: regionSizeB.width > 0 ? regionSizeB.width : 1, height: regionSizeB.height > 0 ? regionSizeB.height : 1 },
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
