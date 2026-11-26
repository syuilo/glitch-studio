import { getPortableParameterDefinitions } from '@gs/glitch-studio_embed/parameters.ts';
import { colorBlendModes } from '@gs/shared/color-blend.ts';
import { validateColorRamp } from '@gs/shared/color-ramp.ts';
import { validateFunctionCurve } from '@gs/shared/function-curve/validate-function-curve.ts';
import { SIZE_REFERENCES } from '@gs/shared/size-reference.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validateNodesEffectWebExportParameterValue(definition: ParameterDefinition, value: unknown): void {
	const fail = () => { throw new Error(`Invalid ${definition.dataType.kind} value for ${JSON.stringify(definition.ui.label)}`); };
	const vector = (length: number) => Array.isArray(value) && value.length === length && value.every(component => typeof component === 'number' && Number.isFinite(component));
	if (isParameterType(definition, 'array')) {
		if (!Array.isArray(value) || (definition.maxElements != null && value.length > definition.maxElements)) return fail();
		for (const element of value) validateNodesEffectWebExportParameterValue(getArrayElementDefinition(definition), element);
		return;
	}
	if (isParameterType(definition, 'struct')) {
		if (!isRecord(value)) return fail();
		const fields = getStructFieldDefinitions(definition);
		if (Object.keys(value).some(key => !Object.hasOwn(fields, key))) return fail();
		for (const [key, field] of Object.entries(fields)) validateNodesEffectWebExportParameterValue(field, Object.hasOwn(value, key) ? value[key] : null);
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
		case 'functionCurve': validateFunctionCurve(value); return;
		default: return fail();
	}
	if (!valid) fail();
}

/** 手入力JSONの誤りは書き出し前に報告し、配布先にはこの検証を同梱しない。 */
export function parseNodesEffectWebExportParameters(nodesEffect: NodesEffect, json: string): Record<string, unknown> {
	const values: unknown = JSON.parse(json);
	if (!isRecord(values)) throw new Error('Parameters must be an object');
	const definitions = getPortableParameterDefinitions(nodesEffect);
	for (const [name, value] of Object.entries(values)) {
		const definition = definitions.get(name);
		if (definition == null) throw new Error(`Unknown public parameter: ${name}`);
		validateNodesEffectWebExportParameterValue(definition, value);
	}
	return values;
}
