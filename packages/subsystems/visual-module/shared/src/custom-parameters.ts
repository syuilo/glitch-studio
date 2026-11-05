import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { inspectStaticParameter, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { VISUAL_MODULE_CUSTOM_PARAMETER_VAR_DEFS } from './expression.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { VisualModule, VisualModuleCustomParameterDefinition, VisualModuleValueParameterBinding } from './types.ts';

export const VISUAL_MODULE_CUSTOM_PARAMETER_TYPES = ['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference'] as const;

export function validateVisualModuleCustomParameterDefinition(definition: VisualModuleCustomParameterDefinition): void {
	if (!(VISUAL_MODULE_CUSTOM_PARAMETER_TYPES as readonly string[]).includes(definition.dataType.kind) || definition.canNode !== false) throw new Error('Unsupported custom parameter type');
	if (definition.id.trim() === '' || definition.nameForReference.trim() === '') throw new Error('Custom parameter ID and name must not be empty');
	validateParameterDefaultValues(definition);
	if (definition.dataType.kind === 'enum') {
		const options = definition.dataType.options;
		const defaultValue = definition.defaultValue.value;
		if (options.length === 0 || options.some(option => option.trim() === '') || new Set(options).size !== options.length || typeof defaultValue !== 'string' || !options.includes(defaultValue)) throw new Error('Invalid custom parameter enum options or default');
	}
}

/** 参照IDは削除後も保持する。存在・型の検査は実際に値を読む評価境界で行う。 */
export function validateVisualModuleCustomParameterBinding(definition: ParameterDefinition, binding: VisualModuleValueParameterBinding): void {
	inspectStaticParameter(definition, binding, (_leaf, value) => {
		if (!isValueParameterBinding(value) && value.inputSource !== 'visualModulePublicParameterReference' && value.inputSource !== 'visualModuleCustomParameterValueReference') throw new Error('Unsupported custom parameter input source');
		if ((value.inputSource === 'visualModulePublicParameterReference' || value.inputSource === 'visualModuleCustomParameterValueReference') && typeof value.parameterId !== 'string') throw new Error('Invalid parameter reference ID');
		if (value.inputSource === 'envVariable' && value.variable !== '' && !(VISUAL_MODULE_CUSTOM_PARAMETER_VAR_DEFS as readonly string[]).includes(value.variable)) throw new Error('Unavailable custom parameter variable: ' + value.variable);
	});
}

export function validateVisualModuleCustomParameters(visualModule: VisualModule): void {
	const definitions = visualModule.customParameterDefs;
	if (new Set(definitions.map(definition => definition.id)).size !== definitions.length || new Set(definitions.map(definition => definition.nameForReference)).size !== definitions.length) throw new Error('Custom parameter ID and name must be unique');
	for (const definition of definitions) {
		validateVisualModuleCustomParameterDefinition(definition);
		validateVisualModuleCustomParameterBinding(definition, visualModule.customParameterValues[definition.id] ?? definition.defaultValue);
	}
}

export function assertVisualModuleParameterReferenceType(target: Pick<ParameterDefinition, 'dataType' | 'ui'>, source: Pick<ParameterDefinition, 'dataType' | 'ui'>): void {
	if (!areDataTypesEqual(target.dataType, source.dataType)) throw new Error(`Parameter reference type mismatch: ${JSON.stringify(source.ui.label)} → ${JSON.stringify(target.ui.label)}`);
}
