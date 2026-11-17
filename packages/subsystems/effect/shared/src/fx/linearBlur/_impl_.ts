import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createLinearBlurTaps, getLinearBlurSampleCount } from './sampling.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const tapTableValues = createShaderBuffer(codeUniforms.tapTable);
		const tapTableBuffer = device.createBuffer({ size: tapTableValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const bindGroup = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: tapTableBuffer } },
		] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', length: 'scalar', angle: 'scalar', focusRadius: 'scalar', dispersion: 'scalar', dispersionFalloff: 'scalar', bias: 'scalar', highlights: 'scalar', jitter: 'scalar' },
			sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		const halfExtent = getSpatialHalfExtent(resolution);
		let previousSampleCount: number | null = null;

		return {
			render: ctx => {
				const sampleCount = getLinearBlurSampleCount(ctx.params.samples);
				if (sampleCount !== previousSampleCount) {
					tapTableValues.set({ taps: createLinearBlurTaps(sampleCount) });
					device.queue.writeBuffer(tapTableBuffer, 0, tapTableValues.arrayBuffer);
					previousSampleCount = sampleCount;
				}
				uniformValues.set({
					halfExtent,
					// 直線のぼかしには回転中心がない。元実装と同じく画面中央からの
					// 距離で保護・分散を決め、長さと方向は出力位置ごとの入力で指定する。
					maximumDistance: Math.hypot(...halfExtent),
					referenceScale: getSizeReferenceLength(ctx.params.sizeReference, resolution) / Math.max(resolution.width, resolution.height),
					samples: sampleCount,
					seed: Math.trunc(ctx.params.seed) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const { input, length, angle, focusRadius, dispersion, dispersionFalloff, bias, highlights, jitter } = ctx.params;
				const variant = pipelines.update({ input, length, angle, focusRadius, dispersion, dispersionFalloff, bias, highlights, jitter }, resolution);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
				tapTableBuffer.destroy();
			},
		};
	},
});
