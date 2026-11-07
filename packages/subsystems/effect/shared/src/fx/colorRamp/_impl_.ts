import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

type ColorRampInputMode = typeof definition.paramDefs.mode.dataType.options[number];

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const colorRamp = createColorRampBindings(device, 0);
		const createPipelines = (mode: ColorRampInputMode) => createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code: colorRamp.shaderCode + '\n' + code,
			schema: { input: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [colorRamp.layout],
			// Modeは描画全体で共通。不要な方式の計算を除去し、対応表のbufferは全方式で共有する。
			constants: { MODE: { clamp: 0, wrap: 1, pingPong: 2 }[mode] },
		});
		const pipelinesByMode = new Map<ColorRampInputMode, ReturnType<typeof createPipelines>>();
		return {
			render: ctx => {
				const mode = ctx.params.mode;
				let pipelines = pipelinesByMode.get(mode);
				if (pipelines == null) {
					pipelines = createPipelines(mode);
					pipelinesByMode.set(mode, pipelines);
				}
				const bindGroup = colorRamp.update(ctx.params.ramp);
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByMode.values()) pipelines.dispose();
				colorRamp.dispose();
			},
		};
	},
});
