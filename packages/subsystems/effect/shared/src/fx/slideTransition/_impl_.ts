import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent, spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
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
		const halfExtent = getSpatialHalfExtent(resolution);
		return {
			render: ctx => {
				const angle = (ctx.params.angle % 1) * 2 * Math.PI;
				const direction = [Math.sin(angle), Math.cos(angle)] as const;
				// いずれかの軸で矩形の全幅を移動すれば完全に画面外へ出る。
				// 等方座標で距離を求め、縦横比によって指定した角度を歪めない。
				const inverseTravelDistance = Math.max(Math.abs(direction[0]) / (halfExtent[0] * 2), Math.abs(direction[1]) / (halfExtent[1] * 2));
				uniformValues.set({
					fullOffset: spatialToNormalizedCoordinates([direction[0] / inverseTravelDistance, direction[1] / inverseTravelDistance], resolution),
					pixelSize: [2 / resolution.width, 2 / resolution.height],
					uncover: ctx.params.mode === 'uncover' ? 1 : 0,
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
