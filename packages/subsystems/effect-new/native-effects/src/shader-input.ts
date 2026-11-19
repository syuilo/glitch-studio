import { createShaderInputBindings, generateShaderInputs, type FixedShaderInput, type ShaderInputType } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import { toFixedShaderInput, type EffectImageInput } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';

/** 配置の生成時に使用する入力だけを束縛する。値とテクスチャの差し替えは各入力のgetterから読む。 */
export function createNativeEffectInputBindings<Key extends string>({ device, resolution, schema, inputs, group, sampling }: {
	device: GPUDevice;
	resolution: Resolution;
	schema: Readonly<Record<Key, ShaderInputType>>;
	inputs: Readonly<Record<NoInfer<Key>, EffectImageInput>>;
	group: number;
	sampling?: 'implicit' | 'level0';
}) {
	const fixedInputs: Record<string, FixedShaderInput> = Object.create(null);
	for (const key in schema) fixedInputs[key] = toFixedShaderInput(inputs[key]);
	const generated = generateShaderInputs(schema, fixedInputs, group, sampling);
	const bindings = createShaderInputBindings(device, generated);
	try {
		return { code: generated.code, layout: bindings.layout, getBindGroup: bindings.bindFixedInputs(fixedInputs, resolution), dispose: bindings.dispose };
	} catch (error) {
		bindings.dispose();
		throw error;
	}
}
