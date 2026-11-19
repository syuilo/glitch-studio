import { createShaderInputBindings, generateShaderInputs, type FixedShaderInput, type FixedShaderInputSamplingOverrides, type ShaderInputSchema } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import { toFixedShaderInput, type EffectImageInput } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';

export type NativeShaderInput = EffectImageInput | { readonly kind: 'array'; readonly elements: readonly EffectImageInput[] };

/** 配置の生成時に使用する入力だけを束縛する。値とテクスチャの差し替えは各入力のgetterから読む。 */
export function createNativeEffectInputBindings<Key extends string>({ device, resolution, schema, inputs, group, sampling, scalarGradients, samplingOverrides }: {
	device: GPUDevice;
	resolution: Resolution;
	schema: Readonly<Record<Key, ShaderInputSchema[string]>>;
	inputs: Readonly<Record<NoInfer<Key>, NativeShaderInput>>;
	group: number;
	sampling?: 'implicit' | 'level0';
	scalarGradients?: boolean;
	samplingOverrides?: FixedShaderInputSamplingOverrides;
}) {
	const fixedInputs: Record<string, FixedShaderInput | readonly FixedShaderInput[]> = Object.create(null);
	for (const key in schema) {
		const input = inputs[key];
		fixedInputs[key] = input.kind === 'array' ? input.elements.map(toFixedShaderInput) : toFixedShaderInput(input);
	}
	const generated = generateShaderInputs(schema, fixedInputs, group, sampling, scalarGradients);
	const bindings = createShaderInputBindings(device, generated);
	try {
		return { code: generated.code, layout: bindings.layout, getBindGroup: bindings.bindFixedInputs(fixedInputs, resolution, samplingOverrides), dispose: bindings.dispose };
	} catch (error) {
		bindings.dispose();
		throw error;
	}
}
