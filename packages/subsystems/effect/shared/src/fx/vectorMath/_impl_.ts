import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { vectorMathOperations } from './operations.ts';
import type { VectorMathOperation } from './operations.ts';
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
		const createPipelines = (operation: VectorMathOperation) => createShaderInputPipeline({
			device: wgpu.device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputA: 'vector', inputB: 'vector', scale: 'scalar', angle: 'scalar' },
			targets: [{ format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float' }],
			sampling: 'level0',
			// 演算は画面全体で共通。未使用の演算・サンプルはコンパイル時に除去する。
			constants: { OPERATION: vectorMathOperations[operation].shaderOperationId },
		});
		const pipelinesByOperation = new Map<VectorMathOperation, ReturnType<typeof createPipelines>>();
		return {
			render: ctx => {
				const operation = ctx.params.operation;
				let pipelines = pipelinesByOperation.get(operation);
				if (pipelines == null) {
					pipelines = createPipelines(operation);
					pipelinesByOperation.set(operation, pipelines);
				}
				const variant = pipelines.update({ inputA: ctx.params.inputA, inputB: ctx.params.inputB, scale: ctx.params.scale, angle: ctx.params.angle }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByOperation.values()) pipelines.dispose();
			},
		};
	},
});
