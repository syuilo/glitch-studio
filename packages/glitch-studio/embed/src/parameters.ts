import { colorBlendModes } from '@gs/shared/color-blend.ts';
import { validateColorRamp } from '@gs/shared/color-ramp.ts';
import { SIZE_REFERENCES } from '@gs/shared/size-reference.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { mapParameterTree } from '@gs/shared/parameter/parameter-tree.ts';
import type { ParameterDefaultValue, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffectParamDef } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function validatePortableParameterValue(definition: ParameterDefinition, value: unknown): void {
	const fail = () => { throw new Error(`Invalid ${definition.dataType.kind} value for ${JSON.stringify(definition.ui.label)}`); };
	const vector = (length: number) => Array.isArray(value) && value.length === length && value.every(component => typeof component === 'number' && Number.isFinite(component));
	if (isParameterType(definition, 'array')) {
		if (!Array.isArray(value) || (definition.maxElements != null && value.length > definition.maxElements)) return fail();
		for (const element of value) validatePortableParameterValue(getArrayElementDefinition(definition), element);
		return;
	}
	if (isParameterType(definition, 'struct')) {
		if (!isRecord(value)) return fail();
		const fields = getStructFieldDefinitions(definition);
		if (Object.keys(value).some(key => !Object.hasOwn(fields, key))) return fail();
		for (const [key, field] of Object.entries(fields)) validatePortableParameterValue(field, Object.hasOwn(value, key) ? value[key] : null);
		return;
	}
	let valid: boolean;
	switch (definition.dataType.kind) {
		case 'scalar': valid = typeof value === 'number' && Number.isFinite(value); break;
		case 'bool': valid = typeof value === 'boolean'; break;
		case 'string': valid = typeof value === 'string'; break;
		case 'color': valid = vector(4) && (value as number[])[3] >= 0 && (value as number[])[3] <= 1; break;
		case 'vector': valid = vector(2); break;
		case 'any': valid = value === null || vector(4); break;
		case 'audioSource': valid = value === null; break;
		case 'enum': valid = typeof value === 'string' && definition.dataType.options.includes(value); break;
		case 'blendMode': valid = typeof value === 'string' && Object.hasOwn(colorBlendModes, value); break;
		case 'fitMode': valid = typeof value === 'string' && ['stretch', 'cover', 'contain'].includes(value); break;
		case 'wrapMode': valid = typeof value === 'string' && ['clamp', 'repeat', 'repeatMirrored', 'transparent'].includes(value); break;
		case 'sizeReference': valid = typeof value === 'string' && (SIZE_REFERENCES as readonly string[]).includes(value); break;
		case 'colorRamp': validateColorRamp(value); return;
		default: return fail();
	}
	if (!valid) fail();
}

/** 属性・APIの更新は全項目を検証してから確定し、途中の更新や呼び出し元の参照を残さない。 */
export function validatePortableParameters(definitions: readonly CustomNodeGraphEffectParamDef[], values: unknown): Record<string, unknown> {
	if (!isRecord(values)) throw new Error('Parameters must be an object');
	for (const [name, value] of Object.entries(values)) {
		const definition = definitions.find(definition => definition.nameForReference === name);
		if (definition == null) throw new Error(`Unknown public parameter: ${name}`);
		validatePortableParameterValue(definition, value);
	}
	return structuredClone(values);
}

export function getPortableParameterDefaults(definitions: readonly CustomNodeGraphEffectParamDef[]): Record<string, unknown> {
	return Object.fromEntries(definitions.map(definition => [definition.nameForReference,
		mapParameterTree<ParameterDefaultValue>(definition, definition.defaultValue, [], (leaf, binding) => {
			if (leaf.dataType.kind === 'audioSource') return null;
			validatePortableParameterValue(leaf, binding.value);
			return binding.value;
		}),
	]));
}
