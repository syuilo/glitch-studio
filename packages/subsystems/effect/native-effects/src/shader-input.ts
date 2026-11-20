import { createShaderInputBindings, generateShaderInputs, type ShaderInput, type ShaderInputSamplingOverrides, type ShaderInputSchema } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type NativeShaderInput = ShaderInput | { readonly kind: 'array'; readonly elements: readonly ShaderInput[] };

/** 配置の生成時に使用する入力だけを束縛する。値とテクスチャの差し替えは各入力のgetterから読む。 */
export function createNativeEffectInputBindings<Key extends string>({ device, resolution, schema, inputs, group, sampling, scalarGradients, samplingOverrides }: {
	device: GPUDevice;
	resolution: Resolution;
	schema: Readonly<Record<Key, ShaderInputSchema[string]>>;
	inputs: Readonly<Record<NoInfer<Key>, NativeShaderInput>>;
	group: number;
	sampling?: 'implicit' | 'level0';
	scalarGradients?: boolean;
	samplingOverrides?: ShaderInputSamplingOverrides;
}) {
	const shaderInputs: Record<Key, ShaderInput | readonly ShaderInput[]> = Object.create(null);
	for (const key in schema) {
		const input: NativeShaderInput = inputs[key];
		shaderInputs[key] = input.kind === 'array' ? input.elements : input;
	}
	return createFixedInputBindings(device, schema, shaderInputs, resolution, group, sampling, scalarGradients, samplingOverrides);
}

export type FixedInputs<Key extends string> = Readonly<Record<Key, ShaderInput | readonly ShaderInput[]>>;

/** 入力種別からWGSLと配置を一度だけ作る。複数のcompute/renderパスで同じ入力グループを共有できる。 */
export function createFixedInputBindings<Key extends string>(device: GPUDevice, schema: Record<Key, ShaderInputSchema[string]>,
	inputs: FixedInputs<NoInfer<Key>>, resolution: Resolution, group: number, sampling?: 'implicit' | 'level0', scalarGradients?: boolean,
	samplingOverrides?: ShaderInputSamplingOverrides) {
	const generated = generateShaderInputs(schema, inputs, group, sampling, scalarGradients);
	const bindings = createShaderInputBindings(device, generated);
	try {
		return { code: generated.code, layout: bindings.layout, getBindGroup: bindings.bindFixedInputs(inputs, resolution, samplingOverrides), dispose: bindings.dispose };
	} catch (error) {
		bindings.dispose();
		throw error;
	}
}
