import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
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
		mask: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		edge: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const scalarFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const createPipelines = (outputMask: number) => createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputA: 'color', inputB: 'color', progress: 'scalar', map: 'scalar', edgeColor: 'color' },
			sampling: 'level0', internalLayouts: [layout],
			constants: { OUTPUT_COLOR: (outputMask & 1) !== 0 ? 1 : 0 },
			targets: [
				(outputMask & 1) !== 0 ? { format: INTERMEDIATE_TEXTURE_FORMAT } : null,
				(outputMask & 2) !== 0 ? { format: scalarFormat } : null,
				(outputMask & 4) !== 0 ? { format: scalarFormat } : null,
			],
		});
		// 3出力の任意の組合せを固定locationへ対応させる。色が不要ならoverrideで
		// 画像とEdge Colorの参照を除去し、Mask/Edge単独でも余分な画像を確保しない。
		const pipelinesByOutput = new Map<number, ReturnType<typeof createPipelines>>();
		return {
			render: ctx => {
				const outputs = [ctx.outputDataMap.output, ctx.outputDataMap.mask, ctx.outputDataMap.edge];
				const outputMask = outputs.reduce((mask, output, index) => output == null ? mask : mask | (1 << index), 0);
				if (outputMask === 0) return;
				uniformValues.set({
					softness: Math.max(0, ctx.params.softness),
					edgeWidth: Math.max(0, ctx.params.edgeWidth),
					edgeIntensity: Math.max(0, ctx.params.edgeIntensity),
					reverse: ctx.params.reverse ? 1 : 0,
					antiAlias: ctx.params.antiAlias ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				let pipelines = pipelinesByOutput.get(outputMask);
				if (pipelines == null) {
					pipelines = createPipelines(outputMask);
					pipelinesByOutput.set(outputMask, pipelines);
				}
				const variant = pipelines.update({
					inputA: ctx.params.inputA, inputB: ctx.params.inputB,
					progress: ctx.params.progress, map: ctx.params.map, edgeColor: ctx.params.edgeColor,
				}, resolution);
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: outputs.map(output => output == null ? null : {
						view: output.textureView, loadOp: 'clear' as const, storeOp: 'store' as const,
					}),
				});
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByOutput.values()) pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});

