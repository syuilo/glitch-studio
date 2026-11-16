import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputA: 'color', inputB: 'color', progress: 'scalar', backColor: 'color', backInput: 'color' },
			sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		return {
			render: ctx => {
				const halfExtent = getSpatialHalfExtent(resolution);
				// 実寸の対角線へ沿って剥がす。各軸を正規化したUVの45度では縦横比によって歪む。
				const diagonalLength = Math.hypot(...halfExtent);
				const cornerSigns = { topLeft: [-1, 1], topRight: [1, 1], bottomLeft: [-1, -1], bottomRight: [1, -1] }[ctx.params.corner];
				const referenceScale = getSizeReferenceLength(ctx.params.sizeReference, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					halfExtent,
					axis: [halfExtent[0] * cornerSigns[0] / diagonalLength, halfExtent[1] * cornerSigns[1] / diagonalLength],
					pixelSize: 1 / Math.max(resolution.width, resolution.height),
					// 0は鋭い折り返しの極限として扱い、画素数には依存しない微小半径で除算を保つ。
					curlRadius: Math.max(0.000001, ctx.params.curlRadius * referenceScale),
					backMode: { source: 0, color: 1, input: 2 }[ctx.params.backMode],
					shadowOpacity: Math.max(0, Math.min(1, ctx.params.shadowOpacity)),
					shadowSoftness: Math.max(0, ctx.params.shadowSoftness) * referenceScale,
					shading: Math.max(0, Math.min(1, ctx.params.shading)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({
					inputA: ctx.params.inputA, inputB: ctx.params.inputB, progress: ctx.params.progress,
					backColor: ctx.params.backColor, backInput: ctx.params.backInput,
				}, resolution);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); uniformBuffer.destroy(); },
		};
	},
});
