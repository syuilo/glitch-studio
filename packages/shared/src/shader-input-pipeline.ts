import { createShaderInputBindings, generateShaderInputs } from './shader-input.ts';
import type { ShaderInput, ShaderInputSchema } from './shader-input.ts';

/** 入力種別ごとのpipelineと入力bufferを所有する。内部リソースは先行するgroupへ置く。 */
export function createShaderInputPipeline(options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	code: string;
	schema: ShaderInputSchema;
	targets: GPUColorTargetState[];
	internalLayouts?: GPUBindGroupLayout[];
	sampling?: 'implicit' | 'level0';
	entryPoint?: string;
	constants?: Record<string, number>;
}) {
	const { device } = options;
	const internalLayouts = options.internalLayouts ?? [];
	const names = Object.keys(options.schema);
	const variants = new Map<string, { pipeline: GPURenderPipeline; bindings: ReturnType<typeof createShaderInputBindings> }>();
	return {
		inputGroup: internalLayouts.length,
		update(inputs: Record<string, ShaderInput>, output: { width: number; height: number }) {
			const key = names.map(name => inputs[name].kind).join(',');
			let variant = variants.get(key);
			if (variant == null) {
				const generated = generateShaderInputs(options.schema, inputs, internalLayouts.length, options.sampling);
				const bindings = createShaderInputBindings(device, generated);
				try {
					const pipeline = device.createRenderPipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [...internalLayouts, bindings.layout] }),
						vertex: { module: options.vertex },
						fragment: { module: device.createShaderModule({ code: generated.code + '\n' + options.code }), targets: options.targets, entryPoint: options.entryPoint, constants: options.constants },
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
			return { pipeline: variant.pipeline, bindGroup: variant.bindings.update(inputs, output) };
		},
		dispose() {
			for (const variant of variants.values()) variant.bindings.dispose();
			variants.clear();
		},
	};
}
