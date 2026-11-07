import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

type ScalarRangeLimitMode = typeof definition.paramDefs.mode.dataType.options[number];

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const createPipelines = (mode: ScalarRangeLimitMode) => createShaderInputPipeline({
			device: wgpu.device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { input: 'scalar', min: 'scalar', max: 'scalar' },
			targets: [{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' }],
			sampling: 'level0',
			// Modeは描画全体で共通なので、未使用の方式の計算をコンパイル時に除去する。
			constants: { MODE: { clamp: 0, wrap: 1, pingPong: 2 }[mode] },
		});
		const pipelinesByMode = new Map<ScalarRangeLimitMode, ReturnType<typeof createPipelines>>();
		return {
			render: ctx => {
				const mode = ctx.params.mode;
				let pipelines = pipelinesByMode.get(mode);
				if (pipelines == null) {
					pipelines = createPipelines(mode);
					pipelinesByMode.set(mode, pipelines);
				}
				const variant = pipelines.update({ input: ctx.params.input, min: ctx.params.min, max: ctx.params.max }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByMode.values()) pipelines.dispose();
			},
		};
	},
});
