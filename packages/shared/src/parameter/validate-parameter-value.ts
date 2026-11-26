import { isBlendMode } from '../color-blend.ts';
import { validateColorRamp } from '../color-ramp.ts';
import { validateFunctionCurve } from '../function-curve/validate-function-curve.ts';
import { isSizeReference } from '../size-reference.ts';
import type { ParameterDefinition } from './parameter-definition.ts';

/** 既定値などを受け入れる編集・読み込み境界で使い、式の評価結果には適用しない。 */
export function validateParameterValue(definition: Pick<ParameterDefinition, 'dataType' | 'ui'>, value: unknown): void {
	const finiteNumber = (item: unknown) => typeof item === 'number' && Number.isFinite(item);
	const components = (length: number) => Array.isArray(value) && value.length === length && value.every(finiteNumber);
	let valid: boolean;
	switch (definition.dataType.kind) {
		case 'scalar': valid = finiteNumber(value); break;
		case 'vector': valid = components(2); break;
		case 'color': valid = components(4); break;
		case 'colorRamp': validateColorRamp(value); valid = true; break;
		case 'functionCurve': validateFunctionCurve(value); valid = true; break;
		case 'bool': valid = typeof value === 'boolean'; break;
		case 'string': valid = typeof value === 'string'; break;
		case 'enum': valid = typeof value === 'string' && definition.dataType.options.includes(value); break;
		case 'blendMode': valid = isBlendMode(value); break;
		case 'fitMode': valid = value === 'contain' || value === 'cover' || value === 'stretch'; break;
		case 'sizeReference': valid = isSizeReference(value); break;
		case 'wrapMode': valid = value === 'clamp' || value === 'repeat' || value === 'repeatMirrored' || value === 'transparent'; break;
		case 'any': valid = value == null || finiteNumber(value) || (Array.isArray(value) && value.every(finiteNumber)); break;
		default: valid = false;
	}
	if (!valid) throw new Error(`Invalid ${definition.dataType.kind} value for parameter ${JSON.stringify(definition.ui.label)}`);
}
