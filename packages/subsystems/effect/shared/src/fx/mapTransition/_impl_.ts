import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
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
		mask: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const maskFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const createPipelines = (mode: 'color' | 'mask' | 'both') => createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputA: 'color', inputB: 'color', progress: 'scalar', map: 'scalar' },
			sampling: 'level0', internalLayouts: [layout],
			entryPoint: { color: 'fsColor', mask: 'fsMask', both: 'fsBoth' }[mode],
			targets: mode === 'both'
				? [{ format: INTERMEDIATE_TEXTURE_FORMAT }, { format: maskFormat }]
				: [{ format: mode === 'color' ? INTERMEDIATE_TEXTURE_FORMAT : maskFormat }],
		});
		// 出力の組合せごとに必要になったpipelineだけを作る。
		// Mask単独では色のShaderInputを読むentry pointも画像のRender Targetも使用しない。
		const pipelinesByOutput = new Map<'color' | 'mask' | 'both', ReturnType<typeof createPipelines>>();
		return {
			render: ctx => {
				const colorOutput = ctx.outputDataMap.output;
				const maskOutput = ctx.outputDataMap.mask;
				if (colorOutput == null && maskOutput == null) return;
				uniformValues.set({
					softness: Math.max(0, ctx.params.softness),
					reverse: ctx.params.reverse ? 1 : 0,
					antiAlias: ctx.params.antiAlias ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const mode = colorOutput == null ? 'mask' : maskOutput == null ? 'color' : 'both';
				let pipelines = pipelinesByOutput.get(mode);
				if (pipelines == null) {
					pipelines = createPipelines(mode);
					pipelinesByOutput.set(mode, pipelines);
				}
				const variant = pipelines.update({ inputA: ctx.params.inputA, inputB: ctx.params.inputB, progress: ctx.params.progress, map: ctx.params.map }, resolution);
				const outputs = colorOutput == null ? [maskOutput!] : maskOutput == null ? [colorOutput] : [colorOutput, maskOutput];
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: outputs.map(output => ({
						view: output.textureView, loadOp: 'clear' as const, storeOp: 'store' as const,
					})),
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
