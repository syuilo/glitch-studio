import { setTimelineLayerParameterRoot } from '../utility/timeline-parameter-edit.ts';
import { validateTimelineLayerPublicParameterDefinitions, timelineLayerPublicParameterId } from "@gs/subsystems_timeline_shared/public-parameters.ts";
import { hasTimelineLayerParameters } from "@gs/subsystems_timeline_shared/types.ts";
import { findTimelineLayer } from "@gs/subsystems_timeline_shared/layer-tree.ts";
import { resolveParameter } from "@gs/shared/parameter/parameter-path.ts";
import { validateTimelineParameterTree } from "@gs/subsystems_timeline_shared/parameter-binding.ts";
import { deepClone } from "@gs/shared/utility/deep-clone.ts";
import { genId } from "@gs/shared/utility/id.ts";
import { timelineCompositingParamDefs } from "@gs/subsystems_timeline_shared/timeline-compositing.ts";
import { canEditTimelineTransform } from "../utility/timeline-transform-edit.ts";
import { getScene, getLayerParameterDefinitions, resolveLayerParameter } from "../utility/timeline-scene.ts";
import type { TimelineParameterTarget } from "../utility/timeline-scene.ts";
import type { ParamPath } from "@gs/shared/parameter/parameter-path.ts";
import type { ProjectState } from "../Project.ts";
import type { EditableTimelineParameterBinding } from "../types/parameter-edit.ts";
import type { TimelineLayerPublicParameterDefinition, TimelineLayerPublicParameterId } from "@gs/subsystems_timeline_shared/public-parameters.ts";
import type { TimelineTransformBindings, TimelineTransformKey } from "../utility/timeline-transform-edit.ts";
import { createNamedParameterFromLiteral } from "@/utility/named-parameter-creation.ts";
import { defineTimelineCommand } from './timeline-preparation.ts';
import { withCommandContract } from './definition.ts';
import { TIMELINE_COMMAND_CONTRACTS } from './timeline-command-contracts.ts';

export const setTimelineLayerTransformBindingsCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; bindings: TimelineTransformBindings }>({
	label: 'Transform timeline layer',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'parameter', target: 'compositing', kind: 'value' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const keys = Object.keys(payload.bindings) as TimelineTransformKey[];
		const getLayer = (state: ProjectState) => {
			const layer = findTimelineLayer(getScene(state, payload.sceneId).layers, payload.layerId);
			if (!layer || !('compositingParamValues' in layer)) throw new Error('Visual layer not found');
			return layer;
		};
		const layer = getLayer(state);
		// 全項目を先に検証してから反映し、片方だけ適用される状態を作らない。
		for (const key of keys) {
			if (!['position', 'scale', 'rotation'].includes(key)) throw new Error('Invalid transform parameter');
			const binding = payload.bindings[key];
			// 同じドラッグ中に開始値へ戻した項目は、未設定の状態も復元する。
			if (binding == null) continue;
			if (!canEditTimelineTransform(binding, key)) throw new Error('Invalid transform binding');
			validateTimelineParameterTree(timelineCompositingParamDefs[key], binding, false, false);
			const values = binding.inputSource === 'literal' ? [binding.value] : binding.inputSource === 'keyframesTimelineInline'
				? binding.keyframesTimeline.keyframes.map(point => point.value) : [];
			if (!values.every(value => key === 'rotation' ? typeof value === 'number' && Number.isFinite(value)
				: Array.isArray(value) && value.length === 2 && value.every(component => typeof component === 'number' && Number.isFinite(component)))) throw new Error('Invalid transform value');
		}
		for (const key of keys) {
			if (payload.bindings[key] == null) delete layer.compositingParamValues[key];
			else layer.compositingParamValues[key] = deepClone(payload.bindings[key]!);
		}
	},
});

export const createTimelineLayerPublicParameterFromParameterCommandDef = defineTimelineCommand<{
 sceneId: string; layerId: string; parameterGroup: Exclude<import('./timeline-parameter-api.ts').TimelineParameterGroup, 'publicParameter'>; parameterPath: ParamPath;
}, { sceneId: string; layerId: string; parameterId: TimelineLayerPublicParameterId }>({
 label: 'Create and connect timeline layer public parameter',
 scope: input => ({ sceneId: input.sceneId, layerIds: [input.layerId] }),
 changes: (_state, input) => [{ type: 'layer', sceneId: input.sceneId, layerId: input.layerId, changes: [{ type: 'definition' }, { type: 'parameter', target: input.parameterGroup, kind: 'connection' }] }],
 edit: (state, input) => {
  const layer = findTimelineLayer(getScene(state, input.sceneId).layers, input.layerId);
  if (layer == null || !hasTimelineLayerParameters(layer)) throw new Error('Layer cannot own public parameters');
  const target = input.parameterGroup;
  if ((target as TimelineParameterTarget) === 'publicParameter') throw new Error('Public parameter values cannot be promoted in the same layer');
  const definitions = getLayerParameterDefinitions(state, layer, target);
  const rootKey = input.parameterPath[0];
  const rootDefinition = definitions[rootKey];
  if (rootDefinition == null) throw new Error('Timeline parameter not found');
  const draft = { [rootKey]: deepClone(resolveLayerParameter(state, layer, target, [rootKey]).value) };
  const parameter = resolveParameter<EditableTimelineParameterBinding>(definitions, draft, input.parameterPath);
  if (parameter.isVectorComponent) throw new Error('Vector components do not support direct parameter references');
  const parameterId = timelineLayerPublicParameterId(genId());
  const definition = { ...createNamedParameterFromLiteral(parameter.def, parameter.value, layer.publicParameterDefs ?? []), id: parameterId };
  const publicParameterDefinitions = [...layer.publicParameterDefs ?? [], definition];
  validateTimelineLayerPublicParameterDefinitions(publicParameterDefinitions);
  parameter.setValue({ inputSource: 'timelineLayerPublicParameterReference', layerId: layer.id, parameterId });
  setTimelineLayerParameterRoot(layer, target, rootKey, draft[rootKey]);
  layer.publicParameterDefs = publicParameterDefinitions;
  return { sceneId: input.sceneId, layerId: input.layerId, parameterId };
 },
});

export const createTimelineLayerPublicParameterCommandDef = defineTimelineCommand<{
 sceneId: string; layerId: string; definition: TimelineLayerPublicParameterDefinition extends infer Definition ? Definition extends TimelineLayerPublicParameterDefinition ? Omit<Definition, 'id'> : never : never;
}, { sceneId: string; layerId: string; parameterId: TimelineLayerPublicParameterId }>({
 label: 'Create timeline layer public parameter',
 scope: input => ({ sceneId: input.sceneId, layerIds: [input.layerId] }),
 changes: (_state, input) => [{ type: 'layer', sceneId: input.sceneId, layerId: input.layerId, changes: [{ type: 'definition' }] }],
 edit: (state, input) => {
  const layer = findTimelineLayer(getScene(state, input.sceneId).layers, input.layerId);
  if (layer == null || !hasTimelineLayerParameters(layer)) throw new Error('Layer cannot own public parameters');
  const parameterId = timelineLayerPublicParameterId(genId());
  const definition = { ...deepClone(input.definition), id: parameterId } as TimelineLayerPublicParameterDefinition;
  const definitions = [...layer.publicParameterDefs ?? [], definition];
  validateTimelineLayerPublicParameterDefinitions(definitions);
  layer.publicParameterDefs = definitions;
  return { sceneId: input.sceneId, layerId: input.layerId, parameterId };
 },
});

export const replaceTimelineLayerPublicParameterDefinitionCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; definition: TimelineLayerPublicParameterDefinition }>({
	label: 'Update timeline layer public parameter',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'definition' }] }],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const getLayer = (state: ProjectState) => {
			const layer = findTimelineLayer(getScene(state, payload.sceneId).layers, payload.layerId);
			if (layer == null || !hasTimelineLayerParameters(layer)) throw new Error('Layer cannot own public parameters');
			return layer;
		};
		const layer = getLayer(state);
		const definitions = [...layer.publicParameterDefs ?? []];
		const index = definitions.findIndex(definition => definition.id === payload.definition.id);
		const previousDefinition = definitions[index];
		if (index < 0) throw new Error('Timeline public parameter not found');
		definitions[index] = deepClone(payload.definition);
		validateTimelineLayerPublicParameterDefinitions(definitions);
		const changesDataType = previousDefinition != null && previousDefinition.dataType.kind !== payload.definition.dataType.kind;
		if (changesDataType) {
			// 旧型の固定値・式・キーを新型で評価すると失敗するため、未設定へ戻して
			// 新しい既定値を使う。UI設定やenumの選択肢だけの変更では保存値を維持する。
			setTimelineLayerParameterRoot(layer, 'publicParameter', payload.definition.id, null);
		}
		layer.publicParameterDefs = definitions;
	},
});

export const removeTimelineLayerPublicParameterDefinitionCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; parameterId: TimelineLayerPublicParameterId }>({
	label: 'Remove timeline layer public parameter',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'definition' }] }],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const getLayer = (state: ProjectState) => {
			const layer = findTimelineLayer(getScene(state, payload.sceneId).layers, payload.layerId);
			if (layer == null || !hasTimelineLayerParameters(layer)) throw new Error('Layer cannot own public parameters');
			return layer;
		};
		const layer = getLayer(state);
		const definitions = layer.publicParameterDefs ?? [];
		if (!definitions.some(definition => definition.id === payload.parameterId)) throw new Error('Timeline public parameter not found');
		layer.publicParameterDefs = definitions.filter(definition => definition.id !== payload.parameterId);
		delete layer.publicParameterValues?.[payload.parameterId];
	},
});

export const TIMELINE_PARAMETERS_COMMAND_DEFS = {
	createTimelineLayerPublicParameter: withCommandContract(createTimelineLayerPublicParameterCommandDef, TIMELINE_COMMAND_CONTRACTS.createTimelineLayerPublicParameter),
	createTimelineLayerPublicParameterFromParameter: withCommandContract(createTimelineLayerPublicParameterFromParameterCommandDef, TIMELINE_COMMAND_CONTRACTS.createTimelineLayerPublicParameterFromParameter),
	replaceTimelineLayerPublicParameterDefinition: withCommandContract(replaceTimelineLayerPublicParameterDefinitionCommandDef, TIMELINE_COMMAND_CONTRACTS.replaceTimelineLayerPublicParameterDefinition),
	removeTimelineLayerPublicParameterDefinition: withCommandContract(removeTimelineLayerPublicParameterDefinitionCommandDef, TIMELINE_COMMAND_CONTRACTS.removeTimelineLayerPublicParameterDefinition),
	setTimelineLayerTransformBindings: withCommandContract(setTimelineLayerTransformBindingsCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerTransformBindings),
};
