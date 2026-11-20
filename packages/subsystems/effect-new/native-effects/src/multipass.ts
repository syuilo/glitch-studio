import { toFixedShaderInput, type EffectImageInput, type EffectParameterInput, type NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFixedInputBindings, type FixedInputs } from './shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { FixedShaderInputSamplingOverrides, ShaderInputSampling, ShaderInputSchema, FixedShaderInput } from '@gs/shared/gpu/shader-input.ts';

type ParameterValues<Inputs> = { readonly [Key in keyof Inputs]: ParameterValue<Inputs[Key]> };
type ParameterValue<Input> = Input extends EffectImageInput ? FixedShaderInput
	: Input extends { kind: 'value'; value: infer Value } ? Value
	: Input extends { kind: 'array'; elements: readonly (infer Element)[] } ? readonly ParameterValue<Element>[]
	: Input extends { kind: 'struct'; fields: infer Fields } ? ParameterValues<Fields> : never;

export type NativeParameterValues<Defs extends Readonly<Record<string, ParameterDefinition>>> =
	ParameterValues<Parameters<NativeEffectImplementation<Defs>['init']>[0]['inputs']>;

/** 配線と配列・構造体の形は配置ごとに一度だけ展開し、式の値と上流のtextureだけを描画時に読む。 */
export function bindParameterValues<Inputs extends Readonly<Record<string, EffectParameterInput>>>(inputs: Inputs): ParameterValues<Inputs> {
	function bindProperty(target: object, key: string | number, input: EffectParameterInput) {
		switch (input.kind) {
			case 'value':
				Object.defineProperty(target, key, { enumerable: true, get: () => input.value });
				break;
			case 'array': {
				const elements: unknown[] = [];
				input.elements.forEach((element, index) => bindProperty(elements, index, element));
				Object.defineProperty(target, key, { enumerable: true, value: elements });
				break;
			}
			case 'struct':
				Object.defineProperty(target, key, { enumerable: true, value: bindParameterValues(input.fields) });
				break;
			default:
				Object.defineProperty(target, key, { enumerable: true, value: toFixedShaderInput(input) });
		}
	}

	const values = Object.create(null);
	for (const key in inputs) bindProperty(values, key, inputs[key]);
	return values;
}

export function beginOutputPass(encoder: GPUCommandEncoder, view: GPUTextureView) {
	return encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
}

export function createFixedInputPipeline<Key extends string>(inputs: FixedInputs<NoInfer<Key>>, resolution: Resolution, options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	code: string;
	schema: Record<Key, ShaderInputSchema[string]>;
	targets: (GPUColorTargetState | null)[];
	internalLayouts?: readonly GPUBindGroupLayout[];
	sampling?: 'implicit' | 'level0';
	scalarGradients?: boolean;
	samplingOverrides?: FixedShaderInputSamplingOverrides;
	entryPoint?: string;
	constants?: Record<string, number>;
}) {
	const layouts = options.internalLayouts ?? [];
	const bindings = createFixedInputBindings(options.device, options.schema, inputs, resolution, layouts.length, options.sampling, options.scalarGradients, options.samplingOverrides);
	try {
		const pipeline = options.device.createRenderPipeline({
			layout: options.device.createPipelineLayout({ bindGroupLayouts: [...layouts, bindings.layout] }),
			vertex: { module: options.vertex },
			fragment: {
				module: options.device.createShaderModule({ code: bindings.code + '\n' + options.code }),
				targets: options.targets, entryPoint: options.entryPoint, constants: options.constants,
			},
		});
		return { pipeline, inputGroup: layouts.length, getBindGroup: bindings.getBindGroup, dispose: bindings.dispose };
	} catch (error) {
		bindings.dispose();
		throw error;
	}
}

/** 中間パスのtextureを固定の寸法・サンプリングで次のパスへ渡す。 */
export function intermediateTextureInput(texture: GPUTexture, sampling: ShaderInputSampling): FixedShaderInput {
	return { kind: 'texture', texture, resolution: texture, fitMode: sampling.fitMode, wrapMode: sampling.wrapMode, filterMode: sampling.filterMode };
}
