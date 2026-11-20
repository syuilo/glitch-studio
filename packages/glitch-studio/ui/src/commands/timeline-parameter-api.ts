import { canConnectNodeDataTypes, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import { getArrayElementDefinition, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { preserveParameterExpressionModifier, supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { findTimelineLayer, updateTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { createTimelineParameterDefaultBinding, isTimelineImageInputBinding, validateTimelineParameterTree } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { resolveTimelineImageLayerReference } from '@gs/subsystems_timeline_shared/layer-output.ts';
import { resolveTimelineAnotherLayerAudioReference } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { getTimelineLayerPublicParameterContext, resolveTimelineLayerPublicParameterReference, areTimelinePublicParameterTypesCompatible } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import { getScene, getLayerParameterDefinitions, resolveLayerParameter } from '../utility/timeline-scene.ts';
import { prepareTimelineEdit } from './timeline-preparation.ts';
import { withCommandContract } from './definition.ts';
import { TIMELINE_COMMAND_CONTRACTS } from './timeline-command-contracts.ts';
import { getParameterBindingChangeKind } from './parameter-change.ts';
import type { ConnectionTypePolicy } from '@gs/shared/data-type/node-compatibility.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { TimelineLayer, TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';
import type { ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { EditableTimelineParameterBinding } from '../types/parameter-edit.ts';
import type { CommandDef } from './definition.ts';
import { applyTimelineParameterEdit, setTimelineLayerParameterRoot } from '../utility/timeline-parameter-edit.ts';
import type { TimelineParameterEditInput } from '../utility/timeline-parameter-edit.ts';

export type TimelineParameterGroup = TimelineParameterTarget;
export type TimelineParameterReference = { sceneId: string; layerId: string; parameterGroup: TimelineParameterGroup; parameterPath: ParamPath };
export type TimelineParameterSource = EditableTimelineParameterBinding extends infer Binding ? Binding extends EditableTimelineParameterBinding ? Omit<Binding, 'expressionModifier'> : never : never;
export type TimelineParameterBindingInput = TimelineParameterReference & { binding: EditableTimelineParameterBinding; connectionTypePolicy?: ConnectionTypePolicy | null };

/** UIの編集イベントをBindingへ変換する。Commandの公開入力にはUIイベントのkindを含めない。 */
export function getTimelineParameterEditBinding(state: ProjectState, input: TimelineParameterEditInput): TimelineParameterBindingInput {
	const scene = getScene(state, input.sceneId);
	const layer = findTimelineLayer(scene.layers, input.layerId);
	if (layer == null) throw new Error('Timeline layer not found');
	const target = input.target ?? 'effect';
	const clonedLayer = deepClone(layer);
	const draft = { ...state, timelineScenes: { value: state.timelineScenes.value.map(value => value.id === scene.id ? { ...scene, layers: updateTimelineLayer(scene.layers, layer.id, () => clonedLayer) } : value) } } as ProjectState;
	applyTimelineParameterEdit(draft, deepClone(input));
	return {
		sceneId: input.sceneId, layerId: input.layerId, parameterGroup: target,
		// 末端のパスを保持する。ルートへ縮めると、別の配列要素やstructフィールドも
		// 同じ連続編集として扱われる。ルート全体の検証はCommand側で行う。
		parameterPath: [...input.paramPath], binding: deepClone(resolveLayerParameter(draft, clonedLayer, target, input.paramPath).value),
	};
}

function resolveEditableParameter(state: ProjectState, input: TimelineParameterReference) {
	const target: TimelineParameterTarget = input.parameterGroup;
	const layer = findTimelineLayer(getScene(state, input.sceneId).layers, input.layerId);
	if (layer == null) throw new Error('Timeline layer not found');
	if (input.parameterPath.length === 0) throw new Error('Parameter path cannot be empty');
	const definitions = getLayerParameterDefinitions(state, layer, target);
	const rootKey = input.parameterPath[0];
	const definition = definitions[rootKey];
	if (definition == null) throw new Error('Timeline parameter not found');
	const root = resolveLayerParameter(state, layer, target, [rootKey]);
	const values = { [rootKey]: deepClone(root.value) };
	return { target, layer, rootKey, definition, values, parameter: resolveParameter<EditableTimelineParameterBinding>(definitions, values, input.parameterPath) };
}

function validateParameterReferences(state: ProjectState, layer: TimelineLayer, target: TimelineParameterTarget, definition: ParameterDefinition, binding: EditableTimelineParameterBinding, sceneId: string, previousBinding: EditableTimelineParameterBinding, connectionTypePolicy: ConnectionTypePolicy): void {
	validateTimelineParameterTree(definition, binding, target === 'effect', target === 'effect');
	const previous = new Map([...walkParameters<EditableTimelineParameterBinding>({ value: definition }, { value: previousBinding })].map(entry => [JSON.stringify(entry.path), entry.value]));
	for (const { path, def, value } of walkParameters<EditableTimelineParameterBinding>({ value: definition }, { value: binding })) {
		const oldValue = previous.get(JSON.stringify(path));
		// 参照先削除後もIDを保持し、サンプリング設定などの修正とUndoによる復旧を妨げない。
		if (oldValue?.inputSource === value.inputSource && 'layerId' in value && 'layerId' in oldValue && value.layerId === oldValue.layerId
			&& (!('parameterId' in value) || ('parameterId' in oldValue && value.parameterId === oldValue.parameterId))) continue;
		if (value.inputSource === 'lowerLayerOutput' && oldValue?.inputSource === 'lowerLayerOutput') continue;
		if (isTimelineImageInputBinding(value) && !canConnectNodeDataTypes({ kind: 'color' }, getNodeInputDataType(def), connectionTypePolicy)) {
			throw new Error('Timeline image output type does not match the parameter');
		}
		if (value.inputSource === 'anotherLayerOutput' && value.layerId != null && resolveTimelineImageLayerReference(getScene(state, sceneId).layers, layer.id, value.layerId) == null) throw new Error('Invalid timeline image source');
		if (value.inputSource === 'anotherLayerAudio' && value.layerId != null && resolveTimelineAnotherLayerAudioReference(getScene(state, sceneId), layer.id, value.layerId) == null) throw new Error('Invalid timeline audio source');
		if (value.inputSource === 'timelineLayerPublicParameterReference' && value.layerId != null) {
			const context = getTimelineLayerPublicParameterContext(getScene(state, sceneId).layers, layer.id)!;
			const source = resolveTimelineLayerPublicParameterReference(context, value.layerId, value.parameterId, target === 'publicParameter');
			if (source == null || !areTimelinePublicParameterTypesCompatible(def, source.definition)) throw new Error('Invalid timeline public parameter source');
		}
	}
}

export const replaceTimelineLayerParameterBindingCommandDef: CommandDef<TimelineParameterBindingInput> = {
	label: 'Replace timeline layer parameter binding',
	prepare: (state, input) => {
		const previous = resolveEditableParameter(state, input);
		const kind = getParameterBindingChangeKind(previous.parameter.def, previous.parameter.value, input.binding);
		return prepareTimelineEdit(state, { sceneId: input.sceneId, layerIds: [input.layerId] }, draft => {
			const { layer, target, rootKey, definition, values, parameter } = resolveEditableParameter(draft, input);
			const previousBinding = deepClone(values[rootKey]);
			parameter.setValue(deepClone(input.binding));
			validateParameterReferences(draft, layer, target, definition, values[rootKey], input.sceneId, previousBinding, input.connectionTypePolicy ?? 'allowMismatch');
			setTimelineLayerParameterRoot(layer, target, rootKey, values[rootKey]);
		}, () => [{ type: 'layer', sceneId: input.sceneId, layerId: input.layerId, changes: [{ type: 'parameter', target: previous.target, kind }] }]);
	},
};

export const setTimelineLayerParameterSourceCommandDef: CommandDef<TimelineParameterReference & { source: TimelineParameterSource; connectionTypePolicy?: ConnectionTypePolicy | null }> = {
	label: 'Set timeline layer parameter source',
	getAutoMergeKey: input => input.source.inputSource === 'literal' || input.source.inputSource === 'expression' ? JSON.stringify([input.sceneId, input.layerId, input.parameterGroup, input.parameterPath, input.source.inputSource]) : null,
	prepare: (state, input) => {
		const { parameter } = resolveEditableParameter(state, input);
		if (parameter.def.dataType.kind === 'array' || parameter.def.dataType.kind === 'struct') throw new Error('Struct and array containers cannot change input source');
		const source = deepClone(input.source) as EditableTimelineParameterBinding;
		if ('expressionModifier' in source) delete source.expressionModifier;
		return replaceTimelineLayerParameterBindingCommandDef.prepare(state, { ...input, binding: preserveParameterExpressionModifier(parameter.value, source) });
	},
};
export const setTimelineLayerParameterExpressionModifierCommandDef: CommandDef<TimelineParameterReference & { expressionModifier: ParameterExpressionModifier | null }> = {
	label: 'Set timeline layer parameter expression modifier',
	prepare: (state, input) => {
		const { parameter } = resolveEditableParameter(state, input);
		if (!supportsParameterExpressionModifier(parameter.def, parameter.value)) throw new Error('Expression modifier is not available for this parameter');
		return replaceTimelineLayerParameterBindingCommandDef.prepare(state, { ...input, binding: { ...parameter.value, expressionModifier: deepClone(input.expressionModifier) } as EditableTimelineParameterBinding });
	},
};

function withParameterChangeKind<Result>(
	prepared: PreparedCommand<ProjectState, AppStateChange, Result> | Promise<PreparedCommand<ProjectState, AppStateChange, Result>>,
	kind: ParameterChangeKind,
) {
	const update = (value: PreparedCommand<ProjectState, AppStateChange, Result>) => ({
		...value,
		change: value.change == null ? null : {
			...value.change,
			changes: value.change.changes.map(change => change.type === 'layer' ? {
				...change,
				changes: change.changes.map(edit => edit.type === 'parameter' ? { ...edit, kind } : edit),
			} : change),
		},
	});
	return prepared instanceof Promise ? prepared.then(update) : update(prepared);
}

export const resetTimelineLayerParameterCommandDef: CommandDef<TimelineParameterReference> = {
	label: 'Reset timeline layer parameter',
	prepare: (state, input) => {
		const binding = getTimelineParameterEditBinding(state, {
			sceneId: input.sceneId,
			layerId: input.layerId,
			target: input.parameterGroup,
			paramPath: input.parameterPath,
			edit: { kind: 'reset' },
		});
		return withParameterChangeKind(replaceTimelineLayerParameterBindingCommandDef.prepare(state, binding), 'reset');
	},
};
export const insertTimelineLayerParameterArrayElementCommandDef: CommandDef<TimelineParameterReference, TimelineParameterReference & { elementId: string }> = {
	label: 'Insert timeline layer parameter array element',
	prepare: (state, input) => {
		const { parameter } = resolveEditableParameter(state, input);
		if (!isParameterType(parameter.def, 'array') || parameter.value.inputSource !== 'literal') throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<EditableTimelineParameterBinding>[];
		if (parameter.def.maxElements != null && elements.length >= parameter.def.maxElements) throw new Error('Array parameter element limit reached');
		const elementId = genId();
		const binding = createTimelineParameterDefaultBinding(getArrayElementDefinition(parameter.def), genId);
		const prepared = withParameterChangeKind(replaceTimelineLayerParameterBindingCommandDef.prepare(state, {
			...input, binding: { inputSource: 'literal', value: [...elements, { id: elementId, binding }] },
		}), 'arrayElements');
		if (prepared instanceof Promise) throw new Error('Parameter preparation must be synchronous');
		return { ...prepared, result: { ...input, parameterPath: [...input.parameterPath, elementId], elementId } };
	},
};
export const removeTimelineLayerParameterArrayElementCommandDef: CommandDef<TimelineParameterReference & { elementId: string }> = {
	label: 'Remove timeline layer parameter array element',
	prepare: (state, input) => {
		const { parameter } = resolveEditableParameter(state, input);
		if (!isParameterType(parameter.def, 'array') || parameter.value.inputSource !== 'literal') throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<EditableTimelineParameterBinding>[];
		if (!elements.some(element => element.id === input.elementId)) throw new Error('Array element not found');
		return withParameterChangeKind(replaceTimelineLayerParameterBindingCommandDef.prepare(state, { ...input, binding: { inputSource: 'literal', value: elements.filter(element => element.id !== input.elementId) } }), 'arrayElements');
	},
};

export const TIMELINE_PARAMETER_API = {
	replaceTimelineLayerParameterBinding: withCommandContract(replaceTimelineLayerParameterBindingCommandDef, TIMELINE_COMMAND_CONTRACTS.replaceTimelineLayerParameterBinding),
	setTimelineLayerParameterSource: withCommandContract(setTimelineLayerParameterSourceCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerParameterSource),
	setTimelineLayerParameterExpressionModifier: withCommandContract(setTimelineLayerParameterExpressionModifierCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerParameterExpressionModifier),
	resetTimelineLayerParameter: withCommandContract(resetTimelineLayerParameterCommandDef, TIMELINE_COMMAND_CONTRACTS.resetTimelineLayerParameter),
	insertTimelineLayerParameterArrayElement: withCommandContract(insertTimelineLayerParameterArrayElementCommandDef, TIMELINE_COMMAND_CONTRACTS.insertTimelineLayerParameterArrayElement),
	removeTimelineLayerParameterArrayElement: withCommandContract(removeTimelineLayerParameterArrayElementCommandDef, TIMELINE_COMMAND_CONTRACTS.removeTimelineLayerParameterArrayElement),
};
