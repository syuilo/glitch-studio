import { implementEffect } from '../../effect-implementation.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const emptyInput = constantShaderInput('vector', [0, 0]);
		const pipelines = createShaderInputPipeline({
			device: wgpu.device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputA: 'vector', inputB: 'vector', amount: 'scalar' },
			targets: [{ format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float' }],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const inputs = ctx.params.inputs;
				const lastIndex = Math.max(0, inputs.length - 1);
				// NaNは先頭、±Infinityを含む範囲外は端に固定し、空配列でも添字を有限に保つ。
				const index = Math.min(lastIndex, Math.max(0, Number.isNaN(ctx.params.index) ? 0 : ctx.params.index));
				const lowerIndex = Math.floor(index);
				const upperIndex = Math.ceil(index);
				// 全候補をbindingにするとGPUのテクスチャ数上限に達するため、選択した2入力だけを渡す。
				// 入力のShaderInputをそのまま使い、各接続のfit/wrap/filterとデータの値域を維持する。
				const variant = pipelines.update({
					inputA: inputs[lowerIndex] ?? emptyInput,
					inputB: inputs[upperIndex] ?? emptyInput,
					amount: constantShaderInput('scalar', index - lowerIndex),
				}, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
			},
		};
	},
});
