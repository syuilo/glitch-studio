import { createTimelineParameterDefaultBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { getTimelineLayerPublicParameterContext, resolveTimelineLayerPublicParameterReference, areTimelinePublicParameterTypesCompatible } from "@gs/subsystems_timeline_shared/public-parameters.ts";
import { resolveTimelineImageLayerReference } from "@gs/subsystems_timeline_shared/layer-output.ts";
import { hasTimelineLayerParameters } from "@gs/subsystems_timeline_shared/types.ts";
import { findTimelineLayer } from "@gs/subsystems_timeline_shared/layer-tree.ts";
import { resolveParameter, walkParameters } from "@gs/shared/parameter/parameter-path.ts";
import { isValueParameterBinding } from "@gs/shared/parameter/parameter-binding.ts";
import { preserveParameterExpressionModifier, validateParameterExpressionModifier, supportsParameterExpressionModifier } from "@gs/shared/parameter/parameter-expression-modifier.ts";
import { updateStructParameterFields } from "./struct-parameter-edit.ts";
import type { StructParameterFieldBindings } from "./struct-parameter-edit.ts";
import { createLowerLayerOutputBinding, getEffectLayerParameterDefault } from "@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts";
import { getArrayElementDefinition, isParameterType } from "@gs/shared/parameter/parameter-definition.ts";
import { getEffectDefinitions } from "./project-effects.ts";
import { AiSON } from "@syuilo/aiscript";
import { deepClone } from "@gs/shared/utility/deep-clone.ts";
import { genId } from "@gs/shared/utility/id.ts";
import { resolveTimelineAnotherLayerAudioReference } from "@gs/subsystems_timeline_shared/timeline-audio.ts";
import { getScene, getLayerParameterValues, getLayerParameterDefinitions } from "./timeline-scene.ts";
import type { TimelineLayer } from "@gs/subsystems_timeline_shared/types.ts";
import type { TimelineParameterTarget } from "./timeline-scene.ts";
import type { ParamPath } from "@gs/shared/parameter/parameter-path.ts";
import type { ParameterArrayElement } from "@gs/shared/parameter/parameter-binding.ts";
import type { ProjectState } from "../Project.ts";
import type { TimelineAnotherLayerOutputBinding } from "@gs/subsystems_timeline_shared/parameter-binding.ts";
import type { EditableTimelineParameterBinding } from "../types/parameter-edit.ts";
import type { TimelineLayerPublicParameterReferenceBinding, TimelineParameterBinding } from "@gs/subsystems_timeline_shared/parameter-binding.ts";
import type { TimelineEffectParameterBinding, TimelineLowerLayerOutputBinding } from "@gs/subsystems_timeline_shared/parameter-binding.ts";
import type { ValueParameterEdit } from "@/types/parameter-edit.ts";
import { createInlineKeyframesTimeline } from "@/utility/keyframes-timeline.ts";
import { createInlineAutomationGraph } from "@/utility/automation-graph.ts";

export function setTimelineLayerParameterRoot(layer: TimelineLayer, target: TimelineParameterTarget, rootKey: string, binding: EditableTimelineParameterBinding | null | undefined) {
	if (target === 'publicParameter') {
		if (!hasTimelineLayerParameters(layer)) throw new Error('Folder layers cannot own parameters');
		if (binding == null) {
			delete layer.publicParameterValues?.[rootKey];
			if (Object.keys(layer.publicParameterValues ?? {}).length === 0) delete layer.publicParameterValues;
		} else (layer.publicParameterValues ??= {})[rootKey] = deepClone(binding as TimelineParameterBinding);
	} else if (target === 'effect') {
		const values = getLayerParameterValues(layer, target);
		if (binding == null) delete values[rootKey];
		else {
			values[rootKey] = deepClone(binding as TimelineEffectParameterBinding);
		}
	} else {
		const values = getLayerParameterValues(layer, target);
		if (binding == null) delete values[rootKey];
		else {
			if (!isValueParameterBinding(binding) && binding.inputSource !== 'timelineLayerPublicParameterReference') throw new Error('Unsupported layer parameter input source');
			values[rootKey] = deepClone(binding);
		}
	}
}

export type TimelineParameterEditInput = {
	sceneId: string;
	layerId: string;
	paramPath: ParamPath;
} & (
	| { target?: TimelineParameterTarget; edit: ValueParameterEdit | { kind: 'structFields'; fields: StructParameterFieldBindings } | { kind: 'timelineLayerPublicParameterReference'; value: TimelineLayerPublicParameterReferenceBinding } | { kind: 'inputSource'; inputSource: 'timelineLayerPublicParameterReference' } }
	| { target: 'effect'; edit: { kind: 'inputSource'; inputSource: 'lowerLayerAudio' | 'anotherLayerAudio' } | { kind: 'anotherLayerAudio'; value: string | null } }
	| { target: 'effect'; edit: { kind: 'lowerLayerOutput'; value: TimelineLowerLayerOutputBinding } | { kind: 'inputSource'; inputSource: 'lowerLayerOutput' | 'anotherLayerOutput' } | { kind: 'anotherLayerOutput'; value: TimelineAnotherLayerOutputBinding } }
);

/** UIイベントを作業用Layerへ反映する。呼び出し側がLayerを複製し、公開Commandへ完成したBindingを渡す。 */
export function applyTimelineParameterEdit(state: ProjectState, payload: TimelineParameterEditInput) {
	const target = payload.target ?? 'effect';
	const rootKey = payload.paramPath[0];
	const getLayer = (state: ProjectState) => {
		const layer = findTimelineLayer(getScene(state, payload.sceneId).layers, payload.layerId);
		if (layer == null) throw new Error('Timeline layer not found');
		getLayerParameterValues(layer, target);
		return layer;
	};
	const layer = getLayer(state);
	const values = getLayerParameterValues(layer, target);
	const defs = getLayerParameterDefinitions(state, layer, target);
	const rootDef = defs[rootKey];
	if (rootDef == null) throw new Error('Timeline parameter not found');

	const currentRoot = values[rootKey] ?? null;
	const defaultBinding = target === 'effect' && layer.layerType === 'effect' ? getEffectLayerParameterDefault(getEffectDefinitions(state).describe(layer.effectSource), rootKey) : createTimelineParameterDefaultBinding(rootDef);
	const draft = { [rootKey]: deepClone(currentRoot ?? defaultBinding) };
	const resolved = resolveParameter<EditableTimelineParameterBinding>(defs, draft, payload.paramPath);
	const { def, value: current } = resolved;
	const edit = payload.edit;
	let next: EditableTimelineParameterBinding;
	const container = def.dataType.kind === 'array' || def.dataType.kind === 'struct';
	if (container && !['reset', 'addElement', 'removeElement', 'structFields'].includes(edit.kind)) throw new Error('Container parameters must be edited through their children');
	switch (edit.kind) {
		case 'structFields': next = updateStructParameterFields(def, current, edit.fields); break;
		case 'literal': next = { inputSource: 'literal', value: deepClone(edit.value) }; break;
		case 'automationGraphInline':
		case 'keyframesTimelineInline':
		case 'lowerLayerOutput': next = deepClone(edit.value); break;
		case 'anotherLayerOutput': {
			const currentId = current.inputSource === 'anotherLayerOutput' ? current.layerId : null;
			if (edit.value.layerId != null && edit.value.layerId !== currentId
				&& resolveTimelineImageLayerReference(getScene(state, payload.sceneId).layers, layer.id, edit.value.layerId) == null) throw new Error('Image source must be another visual layer in the same scene');
			next = deepClone(edit.value);
			break;
		}
		case 'anotherLayerAudio': {
			const source = resolveTimelineAnotherLayerAudioReference(getScene(state, payload.sceneId), layer.id, edit.value);
			if (edit.value != null && source == null) throw new Error('Audio source must be an audio, video, or scene layer in the same scene');
			next = { inputSource: 'anotherLayerAudio', layerId: edit.value };
			break;
		}
		case 'timelineLayerPublicParameterReference': {
			const context = getTimelineLayerPublicParameterContext(getScene(state, payload.sceneId).layers, layer.id)!;
			const source = resolveTimelineLayerPublicParameterReference(context, edit.value.layerId, edit.value.parameterId, target === 'publicParameter');
			if (edit.value.layerId != null && (source == null || !areTimelinePublicParameterTypesCompatible(def, source.definition))) throw new Error('Public parameter must have a compatible type and belong to an available layer');
			next = deepClone(edit.value);
			break;
		}
		case 'envVariable': next = { inputSource: 'envVariable', variable: edit.value }; break;
		case 'expression': next = { inputSource: 'expression', expression: edit.value }; break;
		case 'expressionModifier': {
			if (!supportsParameterExpressionModifier(def, current)) throw new Error('Expression modifier is not available for this parameter');
			next = { ...current, expressionModifier: deepClone(edit.value) };
			validateParameterExpressionModifier(def, next);
			break;
		}
		case 'automationGraphReference': next = {
			inputSource: 'automationGraphReference',
			trimmedDurationMs: 1000,
			wrapMode: 'repeat',
			offsetMode: 'start',
			...(current.inputSource === 'automationGraphReference' ? current : {}),
			automationGraphId: edit.value,
			...edit.options,
		}; break;
		case 'reset':
			next = payload.paramPath.length === 1 && defaultBinding.inputSource !== 'literal'
				? defaultBinding : createTimelineParameterDefaultBinding(def, genId);
			break;
		case 'addElement':
		case 'removeElement': {
			if (!isParameterType(def, 'array') || current.inputSource !== 'literal') throw new Error('Expected array parameter');
			const elements = current.value as ParameterArrayElement<TimelineEffectParameterBinding>[];
			if (edit.kind === 'addElement' && def.maxElements != null && elements.length >= def.maxElements) throw new Error('Array parameter element limit reached');
			if (edit.kind === 'removeElement' && !elements.some(element => element.id === edit.elementId)) throw new Error('Unknown array element');
			next = {
				inputSource: 'literal',
				value: edit.kind === 'addElement'
					? [...elements, { id: genId(), binding: createTimelineParameterDefaultBinding(getArrayElementDefinition(def), genId) }]
					: elements.filter(element => element.id !== edit.elementId),
			};
			break;
		}
		case 'inputSource':
			switch (edit.inputSource) {
				case 'literal': next = createTimelineParameterDefaultBinding(def); break;
				case 'envVariable': next = { inputSource: 'envVariable', variable: '' }; break;
				case 'expression': next = { inputSource: 'expression', expression: AiSON.stringify(current.inputSource === 'literal' ? current.value : def.defaultValue) }; break;
				case 'automationGraphReference': next = {
					inputSource: 'automationGraphReference',
					automationGraphId: null,
					trimmedDurationMs: 1000,
					wrapMode: 'repeat',
					offsetMode: 'start',
				}; break;
				case 'automationGraphInline': next = createInlineAutomationGraph(); break;
				case 'keyframesTimelineInline': next = createInlineKeyframesTimeline(def, current); break;
				case 'lowerLayerOutput': next = target === 'effect' ? createLowerLayerOutputBinding() : { inputSource: 'lowerLayerOutput' }; break;
				case 'anotherLayerOutput': next = {
					...(target === 'effect' ? createLowerLayerOutputBinding() : {}),
					inputSource: 'anotherLayerOutput',
					layerId: null,
					outputStage: 'source',
				}; break;
				case 'timelineLayerPublicParameterReference': next = { inputSource: 'timelineLayerPublicParameterReference', layerId: null, parameterId: null }; break;
				case 'lowerLayerAudio': next = { inputSource: 'lowerLayerAudio' }; break;
				case 'anotherLayerAudio': next = { inputSource: 'anotherLayerAudio', layerId: null }; break;
				default: throw new Error('Unsupported layer parameter input source');
			}
			break;
	}
	if (edit.kind !== 'reset' && edit.kind !== 'expressionModifier') next = preserveParameterExpressionModifier(current, next);
	resolved.setValue(next);
	for (const { value } of walkParameters<EditableTimelineParameterBinding>({ [rootKey]: rootDef }, draft)) {
		// 整数msへ揃えるのは実時刻のキーだけ。正規化キーの0.5などを
		// 丸めると、一括編集したView内の未変更フィールドまで時刻が壊れる。
		if (value.inputSource === 'keyframesTimelineInline' && !value.keyframesTimeline.isNormalized) {
			for (const point of value.keyframesTimeline.keyframes) point.x = Math.round(point.x);
		}
	}
	// 静的な構造検証は変更通知を受けるProjectRenderValidationが担当する。
	// 生成済みの要素IDをRedoでも使う。

	setTimelineLayerParameterRoot(layer, target, rootKey, draft[rootKey]);
	}
