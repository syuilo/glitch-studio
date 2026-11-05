import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { preserveParameterExpressionModifier, supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { visualModulePublicParameterId, visualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import { validateVisualModuleCustomParameterBinding } from '@gs/subsystems_visual-module_shared/custom-parameters.ts';
import { createResetParameterBinding } from './parameter-default.ts';
import { createInlineAutomationGraph } from './automation-graph.ts';
import { createInlineKeyframesTimeline } from './keyframes-timeline.ts';
import type { VisualModuleCustomParameterDefinition, VisualModuleValueParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModuleValueParameterEdit } from '../types/parameter-edit.ts';

export function editVisualModuleCustomParameterBinding(definition: VisualModuleCustomParameterDefinition, current: VisualModuleValueParameterBinding, edit: VisualModuleValueParameterEdit): VisualModuleValueParameterBinding {
	let next: VisualModuleValueParameterBinding;
	switch (edit.kind) {
		case 'literal': next = { inputSource: 'literal', value: deepClone(edit.value) }; break;
		case 'expression': next = { inputSource: 'expression', expression: edit.value }; break;
		case 'envVariable': next = { inputSource: 'envVariable', variable: edit.value }; break;
		case 'automationGraphInline':
		case 'keyframesTimelineInline': next = deepClone(edit.value); break;
		case 'automationGraphReference': next = { inputSource: 'automationGraphReference', trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start',
			...(current.inputSource === 'automationGraphReference' ? current : {}), automationGraphId: edit.value, ...edit.options }; break;
		case 'visualModulePublicParameterReference': next = { inputSource: edit.kind, parameterId: edit.value }; break;
		case 'visualModuleCustomParameterValueReference': next = { inputSource: edit.kind, parameterId: edit.value }; break;
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
				case 'visualModulePublicParameterReference': next = { inputSource: edit.inputSource, parameterId: visualModulePublicParameterId('') }; break;
				case 'visualModuleCustomParameterValueReference': next = { inputSource: edit.inputSource, parameterId: visualModuleCustomParameterId('') }; break;
			}
			break;
		case 'addElement':
		case 'removeElement': throw new Error('Custom parameters do not support arrays');
	}
	if (edit.kind !== 'reset' && edit.kind !== 'expressionModifier') next = preserveParameterExpressionModifier(current, next);
	validateVisualModuleCustomParameterBinding(definition, next);
	return next;
}
