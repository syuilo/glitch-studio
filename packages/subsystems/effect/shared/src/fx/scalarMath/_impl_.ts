import { implementEffect } from '../../effect-implementation.ts';
import { getLargestInputResolution } from '../../effect-input-resolution.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { scalarMathOperations } from './operations.ts';
import type { ScalarMathOperation } from './operations.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	// 単項演算で以前のB/Cへの接続を残しても、未使用の入力で解像度が変わらないようにする。
	getInputResolution: params => getLargestInputResolution(
		[params.inputA, params.inputB, params.inputC].slice(0, scalarMathOperations[params.operation].inputCount),
	),
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const createPipelines = (operation: ScalarMathOperation) => createShaderInputPipeline({
			device: wgpu.device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { inputA: 'scalar', inputB: 'scalar', inputC: 'scalar' },
			targets: [{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' }],
			sampling: 'level0',
			// 演算は描画全体で共通なので、不要な分岐・入力参照をコンパイル時に除去する。
			constants: { OPERATION: scalarMathOperations[operation].shaderOperationId },
		});
		const pipelinesByOperation = new Map<ScalarMathOperation, ReturnType<typeof createPipelines>>();
		return {
			render: ctx => {
				const operation = ctx.params.operation;
				let pipelines = pipelinesByOperation.get(operation);
				if (pipelines == null) {
					pipelines = createPipelines(operation);
					pipelinesByOperation.set(operation, pipelines);
				}
				const variant = pipelines.update({ inputA: ctx.params.inputA, inputB: ctx.params.inputB, inputC: ctx.params.inputC }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByOperation.values()) pipelines.dispose();
			},
		};
	},
});
