import { inspectStaticParameter, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { NODES_EFFECT_CUSTOM_PARAMETER_VAR_DEFS } from './nodes-effect-expression.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { NodesEffectCustomParameterDefinition, NodesEffectValueParameterBinding } from '../types/nodes-effect-view.ts';

export const NODES_EFFECT_CUSTOM_PARAMETER_TYPES = ['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference'] as const;

export function validateNodesEffectCustomParameterDefinition(definition: NodesEffectCustomParameterDefinition): void {
	if (!(NODES_EFFECT_CUSTOM_PARAMETER_TYPES as readonly string[]).includes(definition.dataType.kind) || definition.canNode !== false) throw new Error('Unsupported custom parameter type');
	if (definition.id.trim() === '' || definition.nameForReference.trim() === '') throw new Error('Custom parameter ID and name must not be empty');
	validateParameterDefaultValues(definition);
	if (definition.dataType.kind === 'enum') {
		const options = definition.dataType.options;
		const defaultValue = definition.defaultValue;
		if (options.length === 0 || options.some(option => option.trim() === '') || new Set(options).size !== options.length || typeof defaultValue !== 'string' || !options.includes(defaultValue)) throw new Error('Invalid custom parameter enum options or default');
	}
}

/** 参照IDは削除後も保持する。存在・型の検査は実際に値を読む評価境界で行う。 */
export function validateNodesEffectCustomParameterBinding(definition: ParameterDefinition, binding: NodesEffectValueParameterBinding): void {
	inspectStaticParameter(definition, binding, (_leaf, value) => {
		if (!isValueParameterBinding(value) && value.inputSource !== 'nodesEffectPublicParameterReference' && value.inputSource !== 'nodesEffectCustomParameterValueReference') throw new Error('Unsupported custom parameter input source');
		if ((value.inputSource === 'nodesEffectPublicParameterReference' || value.inputSource === 'nodesEffectCustomParameterValueReference') && typeof value.parameterId !== 'string') throw new Error('Invalid parameter reference ID');
		if (value.inputSource === 'envVariable' && value.variable !== '' && !(NODES_EFFECT_CUSTOM_PARAMETER_VAR_DEFS as readonly string[]).includes(value.variable)) throw new Error('Unavailable custom parameter variable: ' + value.variable);
	});
}

