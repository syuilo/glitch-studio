import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { preserveParameterExpressionModifier, validateParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParamEdit } from '@/components/GsVisualParam.vue';
import { createInlineAutomationGraph } from './automation-graph.ts';
import { createInlineKeyframesTimeline } from './keyframes-timeline.ts';
import { createResetParameterBinding } from './parameter-default.ts';

export function editEffectLivePreviewParameter(def: ParameterDefinition, current: ValueParameterBinding, event: ParamEdit): ValueParameterBinding | null {
	let next = current;
	const reset = () => createResetParameterBinding(def);
	switch (event.kind) {
		case 'literal': next = { inputSource: 'literal', value: deepClone(event.value) }; break;
		case 'automationGraphInline': next = deepClone(event.value); break;
		case 'keyframesTimelineInline': next = deepClone(event.value); break;
		case 'envVariable': next = { inputSource: 'envVariable', variable: event.value }; break;
		case 'expression': next = { inputSource: 'expression', expression: event.value }; break;
		case 'expressionModifier': next = { ...current, expressionModifier: deepClone(event.value) }; break;
		case 'automationGraphReference': next = {
			inputSource: 'automationGraphReference',
			trimmedDurationMs: 1000,
			wrapMode: 'repeat',
			offsetMode: 'start',
			...(current?.inputSource === 'automationGraphReference' ? current : {}),
			automationGraphId: event.value,
			...event.options,
		}; break;
		case 'copy':
		case 'paste':
		case 'createPublicParameter':
		case 'createCustomParameter':
		case 'timelineLayerPublicParameterReference':
		case 'node':
		case 'anotherLayerOutput':
		case 'lowerLayerOutput':
		case 'anotherLayerAudio':
		case 'customNodeGraphEffectPublicParameterReference': return null;
		case 'customNodeGraphEffectCustomParameterValueReference': return null;
		case 'reset': next = reset(); break;
		case 'inputSource':
			switch (event.inputSource) {
				case 'literal': next = reset(); break;
				case 'expression': next = {
					inputSource: 'expression',
					expression: AiSON.stringify(current?.inputSource === 'literal' ? current.value : def.defaultValue),
				}; break;
				case 'automationGraphReference': next = {
					inputSource: 'automationGraphReference',
					automationGraphId: null,
					trimmedDurationMs: 1000,
					wrapMode: 'repeat',
					offsetMode: 'start',
				}; break;
				case 'automationGraphInline': next = createInlineAutomationGraph(); break;
				case 'keyframesTimelineInline':
					next = createInlineKeyframesTimeline(def, current);
					break;
				case 'customNodeGraphEffectPublicParameterReference':
				case 'customNodeGraphEffectCustomParameterValueReference':
				case 'anotherLayerOutput':
				case 'lowerLayerOutput':
				case 'lowerLayerAudio':
				case 'anotherLayerAudio':
				case 'node':
					return null;
			}
			break;
		case 'addElement':
		case 'removeElement':
			return null;
	}
	if (event.kind !== 'reset' && event.kind !== 'expressionModifier') {
		next = preserveParameterExpressionModifier(current, next);
	}
	validateParameterExpressionModifier(def, next);
	return next;
}
