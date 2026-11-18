import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from './shader-input.ts';
import type { ShaderInputValues, ShaderInputSchema, ShaderInputReferenceResolutions } from './shader-input.ts';

/** シェーダー入力種別ごとのpipelineと入力bufferを所有する。内部リソースは先行するgroupへ置く。 */
export function createShaderInputPipeline<const Schema extends ShaderInputSchema>(options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	code: string;
	schema: Schema;
	// 未使用の出力locationにはnullを渡し、対応するテクスチャを確保せずに描画できる。
	targets: (GPUColorTargetState | null)[];
	internalLayouts?: GPUBindGroupLayout[];
	sampling?: 'implicit' | 'level0';
	scalarGradients?: boolean;
	entryPoint?: string;
	constants?: Record<string, number>;
}) {
	const { device } = options;
	const internalLayouts = options.internalLayouts ?? [];
	const variants = new Map<string, { pipeline: GPURenderPipeline; bindings: ReturnType<typeof createShaderInputBindings> }>();

	function getVariant(inputs: ShaderInputValues<Schema>) {
		const key = shaderInputVariantKey(options.schema, inputs);
		let variant = variants.get(key);
		if (variant == null) {
			const generated = generateShaderInputs(options.schema, inputs, internalLayouts.length, options.sampling, options.scalarGradients);
			const bindings = createShaderInputBindings(device, generated);
			try {
				const pipeline = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [...internalLayouts, bindings.layout] }),
					vertex: { module: options.vertex },
					fragment: {
						module: device.createShaderModule({ code: generated.code + '\n' + options.code }),
						targets: options.targets,
						entryPoint: options.entryPoint,
						constants: options.constants,
					},
					primitive: { topology: 'triangle-list' },
				});
				variant = { pipeline, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
			// 入力の多いエフェクトでも組合せ全体を保持せず、最近使った構成だけ残す。
			if (variants.size >= 16) {
				const oldest = variants.keys().next().value!;
				variants.get(oldest)!.bindings.dispose();
				variants.delete(oldest);
			}
		}
		variants.delete(key);
		variants.set(key, variant);
		return variant;
	}

	return {
		inputGroup: internalLayouts.length,
		/** 描画用の構成を借用する。入力値の書き込みは、選択済みのbindingsに対して描画時に行う。 */
		prepare(inputs: ShaderInputValues<Schema>): { pipeline: GPURenderPipeline; bindings: Pick<ReturnType<typeof createShaderInputBindings>, 'update'> } {
			return getVariant(inputs);
		},
		update(inputs: ShaderInputValues<Schema>, output: { width: number; height: number }, inputReferenceResolutions: ShaderInputReferenceResolutions = {}) {
			const variant = getVariant(inputs);
			return { pipeline: variant.pipeline, bindGroup: variant.bindings.update(inputs, output, inputReferenceResolutions) };
		},
		dispose() {
			for (const variant of variants.values()) variant.bindings.dispose();
			variants.clear();
		},
	};
}
