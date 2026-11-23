import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { preserveParameterExpressionModifier, validateParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { canUseEffectLivePreviewInput } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParamEdit } from '@/components/GsVisualParam.vue';
import { createInlineAutomationGraph } from './automation-graph.ts';
import { createInlineKeyframesTimeline } from './keyframes-timeline.ts';
import { createResetParameterBinding } from './parameter-default.ts';
import type { EffectLivePreviewParameterBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';

export function editEffectLivePreviewParameter(def: ParameterDefinition, current: EffectLivePreviewParameterBinding, event: ParamEdit): EffectLivePreviewParameterBinding | null {
	let next = current;
	const reset = () => createResetParameterBinding(def);
	switch (event.kind) {
		case 'literal': next = { inputSource: 'literal', value: deepClone(event.value) }; break;
		case 'automationGraphInline': next = deepClone(event.value); break;
		case 'keyframesTimelineInline': next = deepClone(event.value); break;
		case 'envVariable': next = { inputSource: 'envVariable', variable: event.value }; break;
		case 'expression': next = { inputSource: 'expression', expression: event.value }; break;
		case 'expressionModifier':
			if (!isValueParameterBinding(current)) return null;
			next = { ...current, expressionModifier: deepClone(event.value) };
			break;
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
		case 'nodesEffectPublicParameterReference': return null;
		case 'nodesEffectCustomParameterValueReference': return null;
		case 'reset': next = reset(); break;
		case 'inputSource':
			switch (event.inputSource) {
				case 'previewInputImage':
				case 'previewInputAudio':
					return canUseEffectLivePreviewInput(def, event.inputSource) ? { inputSource: event.inputSource } : null;
				case 'literal': next = reset(); break;
				case 'envVariable': next = { inputSource: 'envVariable', variable: '' }; break;
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
					next = createInlineKeyframesTimeline(def, isValueParameterBinding(current) ? current : reset());
					break;
				case 'nodesEffectPublicParameterReference':
				case 'nodesEffectCustomParameterValueReference':
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
	if (event.kind !== 'reset' && event.kind !== 'expressionModifier' && isValueParameterBinding(current)) {
		next = preserveParameterExpressionModifier(current, next);
	}
	validateParameterExpressionModifier(def, next);
	return next;
}
