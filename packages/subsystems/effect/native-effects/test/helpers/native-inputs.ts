import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectParameterInput } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { constantShaderInputComponents, type ShaderInput, type TextureShaderInput } from '@gs/shared/gpu/shader-input.ts';

type Values = Record<string, unknown>;
type InputSettings = { canNode?: boolean; element?: InputSettings; fields?: Readonly<Record<string, InputSettings>> };

function literalValue(value: unknown): unknown {
	return value != null && typeof value === 'object' && 'inputSource' in value && value.inputSource === 'literal' && 'value' in value ? value.value : value;
}

function testInput(type: DataType, settings: InputSettings, read: () => unknown): EffectParameterInput {
	if (type.kind === 'array') {
		return { kind: 'array', elements: (read() as unknown[]).map((_, index) =>
			testInput(type.elementType, settings.element!, () => {
				const item = (read() as unknown[])[index];
				return item != null && typeof item === 'object' && 'binding' in item ? literalValue(item.binding) : item;
			})) };
	}
	if (type.kind === 'struct') {
		return { kind: 'struct', fields: Object.fromEntries(Object.entries(type.fields).map(([key, field]) =>
			[key, testInput(field, settings.fields![key], () => literalValue((read() as Values)[key]))])) };
	}
	const input = read() as ShaderInput | null;
	if (input?.kind === 'uniform') {
		return { kind: 'uniform', get value() {
			const { value } = read() as Extract<ShaderInput, { kind: 'uniform' }>;
			return typeof value === 'number' ? [value] : value;
		} };
	}
	if (input?.kind === 'texture') {
		return { kind: 'texture', resolution: input.resolution, sampling: input.sampling,
			get texture() { return (read() as TextureShaderInput).texture; } };
	}
	if (settings.canNode === true) {
		return { kind: 'uniform', get value() { return constantShaderInputComponents(type.kind, read()); } };
	}
	return { kind: 'value', get value() { return read(); } };
}

/** 値だけを変更する試行間では、実装に渡した入力の種類とgetterを維持する。 */
export function createTestInputs(definitions: Readonly<Record<string, ParameterDefinition>>, read: () => Values) {
	return Object.fromEntries(Object.entries(definitions).map(([key, definition]) =>
		[key, testInput(definition.dataType, definition, () => {
			const values = read();
			return key in values ? literalValue(values[key]) : definition.defaultValue;
		})]));
}
