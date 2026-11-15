import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

type ColorRampInputMode = typeof definition.paramDefs.mode.dataType.options[number];

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const colorRamp = createColorRampBindings(device, 0);
		const repetitionValues = createShaderBuffer(uniforms.effectRepetition);
		const repetitionBuffer = device.createBuffer({ size: repetitionValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const repetitionLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const repetitionBindGroup = device.createBindGroup({ layout: repetitionLayout, entries: [
			{ binding: 0, resource: { buffer: repetitionBuffer } },
		] });
		const createPipelines = (mode: ColorRampInputMode) => createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code: colorRamp.shaderCode + '\n' + code,
			schema: { input: 'scalar', repeatCount: 'scalar' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [colorRamp.layout, repetitionLayout],
			// Modeは描画全体で共通。不要な方式の計算を除去し、対応表のbufferは全方式で共有する。
			constants: { MODE: { clamp: 0, wrap: 1, pingPong: 2 }[mode] },
		});
		const pipelinesByMode = new Map<ColorRampInputMode, ReturnType<typeof createPipelines>>();
		return {
			render: ctx => {
				// 繰り返し方法もuniformで更新する。アニメーションの切り替えでpipelineを増やさない。
				repetitionValues.set({ repeatMode: ctx.params.repeatMode === 'wrap' ? 0 : 1 });
				device.queue.writeBuffer(repetitionBuffer, 0, repetitionValues.arrayBuffer);
				const mode = ctx.params.mode;
				let pipelines = pipelinesByMode.get(mode);
				if (pipelines == null) {
					pipelines = createPipelines(mode);
					pipelinesByMode.set(mode, pipelines);
				}
				const bindGroup = colorRamp.update(ctx.params.ramp);
				const variant = pipelines.update({ input: ctx.params.input, repeatCount: ctx.params.repeatCount }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(1, repetitionBindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByMode.values()) pipelines.dispose();
				colorRamp.dispose();
				repetitionBuffer.destroy();
			},
		};
	},
});
