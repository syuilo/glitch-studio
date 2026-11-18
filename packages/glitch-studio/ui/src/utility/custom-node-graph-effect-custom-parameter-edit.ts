import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { preserveParameterExpressionModifier, supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { customNodeGraphEffectPublicParameterId, customNodeGraphEffectCustomParameterId } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import { validateCustomNodeGraphEffectCustomParameterBinding } from '@gs/subsystems_custom-node-graph-effect_shared/custom-parameters.ts';
import { createResetParameterBinding } from './parameter-default.ts';
import { createInlineAutomationGraph } from './automation-graph.ts';
import { createInlineKeyframesTimeline } from './keyframes-timeline.ts';
import type { CustomNodeGraphEffectCustomParameterDefinition, CustomNodeGraphEffectValueParameterBinding } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { CustomNodeGraphEffectValueParameterEdit } from '../types/parameter-edit.ts';

export function editCustomNodeGraphEffectCustomParameterBinding(definition: CustomNodeGraphEffectCustomParameterDefinition, current: CustomNodeGraphEffectValueParameterBinding, edit: CustomNodeGraphEffectValueParameterEdit): CustomNodeGraphEffectValueParameterBinding {
	let next: CustomNodeGraphEffectValueParameterBinding;
	switch (edit.kind) {
		case 'literal': next = { inputSource: 'literal', value: deepClone(edit.value) }; break;
		case 'expression': next = { inputSource: 'expression', expression: edit.value }; break;
		case 'envVariable': next = { inputSource: 'envVariable', variable: edit.value }; break;
		case 'automationGraphInline':
		case 'keyframesTimelineInline': next = deepClone(edit.value); break;
		case 'automationGraphReference': next = { inputSource: 'automationGraphReference', trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start',
			...(current.inputSource === 'automationGraphReference' ? current : {}), automationGraphId: edit.value, ...edit.options }; break;
		case 'customNodeGraphEffectPublicParameterReference': next = { inputSource: edit.kind, parameterId: edit.value }; break;
		case 'customNodeGraphEffectCustomParameterValueReference': next = { inputSource: edit.kind, parameterId: edit.value }; break;
		case 'expressionModifier':
			if (!supportsParameterExpressionModifier(definition, current)) throw new Error('Expression modifier is not available for this parameter');
			next = { ...current, expressionModifier: deepClone(edit.value) }; break;
		case 'reset': next = createResetParameterBinding(definition); break;
		case 'inputSource':
			switch (edit.inputSource) {
				case 'literal': next = deepClone(definition.defaultValue); break;
				case 'expression': next = { inputSource: 'expression', expression: AiSON.stringify(current.inputSource === 'literal' ? current.value : definition.defaultValue.value) }; break;
				case 'envVariable': next = { inputSource: 'envVariable', variable: '' }; break;
				case 'automationGraphInline': next = createInlineAutomationGraph(); break;
				case 'automationGraphReference': next = { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' }; break;
				case 'keyframesTimelineInline': next = createInlineKeyframesTimeline(definition, current); break;
				case 'customNodeGraphEffectPublicParameterReference': next = { inputSource: edit.inputSource, parameterId: customNodeGraphEffectPublicParameterId('') }; break;
				case 'customNodeGraphEffectCustomParameterValueReference': next = { inputSource: edit.inputSource, parameterId: customNodeGraphEffectCustomParameterId('') }; break;
			}
			break;
		case 'addElement':
		case 'removeElement': throw new Error('Custom parameters do not support arrays');
	}
	if (edit.kind !== 'reset' && edit.kind !== 'expressionModifier') next = preserveParameterExpressionModifier(current, next);
	validateCustomNodeGraphEffectCustomParameterBinding(definition, next);
	return next;
}
