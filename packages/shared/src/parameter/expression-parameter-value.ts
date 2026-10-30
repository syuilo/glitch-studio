import { isBlendMode } from '../color-blend.ts';
import { validateColorRamp } from '../color-ramp.ts';
import { coerceParameterValue } from './coerce-parameter-value.ts';
import type { ParameterDefinition } from './parameter-definition.ts';

export type ExpressionParameterDefinition = Pick<ParameterDefinition, 'dataType' | 'ui'>;

/** 式の前後で型を揃える。範囲のclampは最終的な受け取り側に残し、キーのovershootを維持する。 */
export function prepareExpressionParameterValue(definition: ExpressionParameterDefinition, value: unknown): unknown {
	const prepared = coerceParameterValue(definition, value);
	const finiteNumber = (item: unknown) => typeof item === 'number' && Number.isFinite(item);
	const components = (length: number) => Array.isArray(prepared) && prepared.length === length && prepared.every(finiteNumber);
	let valid: boolean;
	switch (definition.dataType.kind) {
		case 'scalar': valid = finiteNumber(prepared); break;
		case 'vector': valid = components(2); break;
		case 'color': valid = components(4); break;
		case 'colorRamp': validateColorRamp(prepared); valid = true; break;
		case 'bool': valid = typeof prepared === 'boolean'; break;
		case 'string': valid = typeof prepared === 'string'; break;
		case 'enum': valid = typeof prepared === 'string' && definition.dataType.options.includes(prepared); break;
		case 'blendMode': valid = isBlendMode(prepared); break;
		case 'fitMode': valid = prepared === 'contain' || prepared === 'cover' || prepared === 'stretch'; break;
		case 'wrapMode': valid = prepared === 'clamp' || prepared === 'repeat' || prepared === 'repeatMirrored' || prepared === 'transparent'; break;
		case 'any': valid = prepared == null || finiteNumber(prepared) || (Array.isArray(prepared) && prepared.every(finiteNumber)); break;
		default: valid = false;
	}
	if (!valid) throw new Error(`Invalid ${definition.dataType.kind} value for parameter ${JSON.stringify(definition.ui.label)}`);
	return prepared;
}
