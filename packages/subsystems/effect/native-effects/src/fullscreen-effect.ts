import type { ShaderInputSchema, FixedShaderInputSamplingOverrides } from '@gs/shared/gpu/shader-input.ts';
import type { EffectInitContext, EffectRenderOperation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createNativeEffectInputBindings, type NativeShaderInput } from './shader-input.ts';

/** 出力locationと入力の種類が固定された、履歴に依存しない全画面パス。 */
export async function createFullscreenEffect<Schema extends ShaderInputSchema>(context: EffectInitContext<unknown>, options: {
	code: string;
	schema: Schema;
	inputs: Readonly<Record<Extract<keyof NoInfer<Schema>, string>, NativeShaderInput>>;
	outputPorts?: readonly string[];
	entryPoint?: string;
	constants?: Record<string, number>;
	sampling?: 'implicit' | 'level0';
	scalarGradients?: boolean;
	samplingOverrides?: FixedShaderInputSamplingOverrides;
	internalLayouts?: readonly GPUBindGroupLayout[];
	bindResources?: (pass: GPURenderPassEncoder) => void;
	disposeResources?: () => void;
}): Promise<EffectRenderOperation> {
	const { device, resolution, defaultVertexShaderModule, outputTextures } = context;
	const layouts = options.internalLayouts ?? [];
	let bindings: ReturnType<typeof createNativeEffectInputBindings> | null = null;

	function dispose() {
		bindings?.dispose();
		options.disposeResources?.();
	}

	try {
		const inputs = createNativeEffectInputBindings<Extract<keyof Schema, string>>({ device, resolution, schema: options.schema, inputs: options.inputs,
			group: layouts.length, sampling: options.sampling, samplingOverrides: options.samplingOverrides, scalarGradients: options.scalarGradients });
		bindings = inputs;
		const targets = (options.outputPorts ?? ['output']).map(id => outputTextures.get(id));
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: targets.map(texture => texture == null ? null : { view: texture.createView(), loadOp: 'clear', storeOp: 'store' }),
		};
		const pipeline = await device.createRenderPipelineAsync({
			layout: device.createPipelineLayout({ bindGroupLayouts: [...layouts, inputs.layout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: inputs.code + '\n' + options.code }), entryPoint: options.entryPoint, constants: options.constants,
				targets: targets.map(texture => texture == null ? null : { format: texture.format }) },
		});
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const pass = commandEncoder.beginRenderPass(descriptor);
				try {
					pass.setPipeline(pipeline);
					options.bindResources?.(pass);
					// 領域ごとのFitは、エフェクトがこのフレームの寸法を確定してから反映する。
					pass.setBindGroup(layouts.length, inputs.getBindGroup());
					pass.draw(3);
				} finally { pass.end(); }
			},
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
