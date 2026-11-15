import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
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
			schema: { inputA: 'color', inputB: 'color', progress: 'scalar' },
			sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		return {
			render: ctx => {
				const referenceScale = getSizeReferenceLength(ctx.params.sizeReference, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution),
					bandSize: Math.max(0.000001, ctx.params.bandSize) * referenceScale,
					stagger: Math.max(0, Math.min(1, ctx.params.stagger)),
					softness: Math.max(0, ctx.params.softness),
					displacement: Math.max(0, ctx.params.displacement) * referenceScale,
					chromaticShift: Math.max(0, ctx.params.chromaticShift) * referenceScale,
					seed: ctx.params.seed >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ inputA: ctx.params.inputA, inputB: ctx.params.inputB, progress: ctx.params.progress }, resolution);
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

