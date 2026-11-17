import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { calculateSplitLayout } from './layout.ts';
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
				const { inputA, inputB, angle, offset, gap, sizeReference } = ctx.params;
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const longSide = Math.max(width, height);
				const halfExtent = getSpatialHalfExtent(output.texture);
				const splitLayout = calculateSplitLayout(halfExtent, angle, offset, gap * getSizeReferenceLength(sizeReference, output.texture) / longSide);
				const { regionA, regionB } = splitLayout;
				uniformValues.set({
					halfExtent,
					longSide,
					normal: splitLayout.normal,
					boundaryA: splitLayout.boundaryA,
					boundaryB: splitLayout.boundaryB,
					centerA: regionA?.center ?? [0, 0],
					centerB: regionB?.center ?? [0, 0],
					halfSizeA: regionA?.halfSize ?? [0, 0],
					halfSizeB: regionB?.halfSize ?? [0, 0],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ inputA, inputB }, output.texture, {
					// 空領域はWGSLで読み飛ばす。Fit計算にだけ正の仮寸法を使って0除算を避け、
					// 実在する領域は1px未満でも寸法を丸めずに渡す。
					inputA: { width: regionA == null ? 1 : regionA.halfSize[0] * 2 * longSide, height: regionA == null ? 1 : regionA.halfSize[1] * 2 * longSide },
					inputB: { width: regionB == null ? 1 : regionB.halfSize[0] * 2 * longSide, height: regionB == null ? 1 : regionB.halfSize[1] * 2 * longSide },
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
