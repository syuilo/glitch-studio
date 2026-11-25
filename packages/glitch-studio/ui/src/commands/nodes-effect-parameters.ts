import { createDefaultParameterBinding, isParameterBindingDefault } from '@gs/shared/parameter/parameter-default.ts';
import { canConnectNodeDataTypes } from '@gs/shared/data-type/node-compatibility.ts';
import { AiSON } from '@syuilo/aiscript';
import { validateStaticSettingValue } from '@gs/shared/static-setting.ts';
import { preserveParameterExpressionModifier, supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { getArrayElementDefinition, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { nodesEffectTargetKey } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { resolveEffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { validateNodesEffectCustomParameterDefinition, validateNodesEffectCustomParameterBinding } from '@/utility/nodes-effect-view-parameters.ts';
import { getNodeOutputs } from '@/utility/nodes-effect-node-outputs.ts';
import { updateStructParameterFields } from '../utility/struct-parameter-edit.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { getNodesEffect } from '../utility/nodes-effect-target.ts';
import { createResetParameterBinding } from '../utility/parameter-default.ts';
import { createInlineKeyframesTimeline } from '../utility/keyframes-timeline.ts';
import { createInlineCurveAnimation } from '../utility/curve-animation.ts';
import { resolveNodeParam } from '../utility/node-params.ts';
import { createNamedParameterFromLiteral } from '../utility/named-parameter-creation.ts';
import { editNodesEffectCustomParameterBinding } from '../utility/nodes-effect-custom-parameter-edit.ts';
import { validateNodesEffectNodeParameterBinding } from './nodes-effect-parameter-validation.ts';
import { includeNodesEffectPublicArgumentChanges } from './nodes-effect-public-arguments.ts';
import { getParameterBindingChangeKind } from './parameter-change.ts';
import { prepareProjectEffectPlacementChanges } from './project-effect-placements.ts';
import { defineCommand, withCommandContract } from './definition.ts';
import { NODES_EFFECT_PARAMETER_CONTRACTS } from './nodes-effect-parameter-contracts.ts';
import { stateUtility } from './nodes-effect.ts';
import { getNodesEffectEffectNode, prepareNodesEffectFields, prepareNodesEffectValue } from './nodes-effect-change.ts';
import type { StructParameterFieldBindings } from '../utility/struct-parameter-edit.ts';
import type { ConnectionTypePolicy } from '@gs/shared/data-type/node-compatibility.ts';
import type { ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { NodesEffectCustomParameterDefinition, NodesEffectValueParameterBinding, NodesEffectParameterBinding, NodesEffectEffectNode, NodesEffect, NodesEffectParamDef, NodesEffectOutputDef } from '@/types/nodes-effect-view.ts';
import type { NodesEffectTarget } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';
import type {
	NodesEffectOutputSource,
	NodesEffectEffectNode as StoredNodesEffectEffectNode,
	NodesEffectParameterBinding as StoredNodesEffectParameterBinding,
	NodeOutputReference,
} from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { NodesEffectNodeReference } from './nodes-effect-change.ts';

import type { ProjectState, AppStateChange } from '../Project.ts';

export type NodesEffectNodeParameterReference = { target: NodesEffectNodeReference; parameterPath: ParamPath };
export type NodesEffectPublicParameterReference = { nodesEffect: NodesEffectTarget; parameterId: string };
export type NodesEffectCustomParameterReference = { nodesEffect: NodesEffectTarget; parameterId: string };
export type NodesEffectOutputReference = { nodesEffect: NodesEffectTarget; outputId: string };
type WithoutExpressionModifier<Value> = Value extends unknown ? Omit<Value, 'expressionModifier'> : never;
export type NodesEffectParameterSource = WithoutExpressionModifier<NodesEffectParameterBinding>;
export type NodesEffectCustomParameterSource = WithoutExpressionModifier<NodesEffectValueParameterBinding>;

function parameterChanges(input: NodesEffectNodeParameterReference, kind: ParameterChangeKind): AppStateChange[] {
	return [{ type: 'node', target: input.target.nodesEffect, nodeId: input.target.nodeId, changes: [{ type: 'parameter', kind }] }];
}

function defineNodeParameterCommand<Input extends NodesEffectNodeParameterReference & { connectionTypePolicy?: ConnectionTypePolicy | null }>(
	label: string,
	update: (parameter: ReturnType<typeof resolveNodeParam>, input: Input) => NodesEffectParameterBinding,
	options: { kind?: ParameterChangeKind; preserveModifier?: boolean; autoMerge?: boolean } = {},
) {
	return defineCommand<Input>({
		label,
		getAutoMergeKey: input => {
			const source = 'source' in input ? input.source as NodesEffectParameterSource : null;
			return options.autoMerge === true && (source?.inputSource === 'literal' || source?.inputSource === 'expression')
				? JSON.stringify([nodesEffectTargetKey(input.target.nodesEffect), input.target.nodeId, input.parameterPath, source.inputSource]) : null;
		},
		prepare(state, input) {
			const parameter = resolveNodeParam(getNodesEffectEffectNode(state, input.target), input.parameterPath, getEffectDefinitions(state));
			// prepare中に更新関数へ渡す値も複製し、検証失敗でライブ状態を変更しない。
			const draftParameter = { ...parameter, value: deepClone(parameter.value) };
			const updated = update(draftParameter, input);
			const after = options.preserveModifier === true ? preserveParameterExpressionModifier(parameter.value, updated) : updated;

			validateNodesEffectNodeParameterBinding(state, getNodesEffect(state, input.target.nodesEffect), parameter.def, after, parameter.value, input.connectionTypePolicy ?? 'strict');
			return prepareNodesEffectValue(parameter.value, after, (currentState, value) => {
				resolveNodeParam(getNodesEffectEffectNode(currentState, input.target), input.parameterPath, getEffectDefinitions(currentState)).setValue(value);
			}, parameterChanges(input, options.kind ?? getParameterBindingChangeKind(parameter.def, parameter.value, after)));
		},
	});
}

function assertLeafParameter(parameter: ReturnType<typeof resolveNodeParam>) {
	if (parameter.def.dataType.kind === 'array' || parameter.def.dataType.kind === 'struct') throw new Error('Struct and array containers cannot change input source');
}

const setNodesEffectNodeParameterSource = defineNodeParameterCommand<NodesEffectNodeParameterReference & {
	source: NodesEffectParameterSource; preserveNodeSampling?: boolean; connectionTypePolicy?: ConnectionTypePolicy | null;
}>(
	'Set Nodes Effect node parameter source',
	(parameter, input) => {
		assertLeafParameter(parameter);
		const source = deepClone(input.source);
		// Sourceは修飾式を所有しない。型のない呼び出しでも混入させない。
		if ('expressionModifier' in source) delete source.expressionModifier;
		if (source.inputSource === 'node' && source.nodeId != null && input.preserveNodeSampling === true && parameter.value.inputSource === 'node' && parameter.value.nodeId != null) {
			return { ...source, fitMode: parameter.value.fitMode, wrapMode: parameter.value.wrapMode, filterMode: parameter.value.filterMode };
		}
		return source;
	},
	{ preserveModifier: true, autoMerge: true },
);

const switchNodesEffectNodeParameterInputSource = defineNodeParameterCommand<NodesEffectNodeParameterReference & { inputSource: NodesEffectParameterBinding['inputSource'] }>(
	'Switch Nodes Effect node parameter input source',
	(parameter, input) => {
		assertLeafParameter(parameter);
		switch (input.inputSource) {
			case 'literal': return createDefaultParameterBinding(parameter.def);
			case 'expression': return { inputSource: 'expression', expression: AiSON.stringify(parameter.value.inputSource === 'literal' ? parameter.value.value : parameter.def.defaultValue) };
			case 'envVariable': return { inputSource: 'envVariable', variable: '' };
			case 'curveAnimationReference': return { inputSource: 'curveAnimationReference', curveAnimationId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' };
			case 'curveAnimationInline': return createInlineCurveAnimation();
			case 'keyframesTimelineInline': return createInlineKeyframesTimeline(parameter.def, parameter.value);
			case 'nodesEffectPublicParameterReference': return { inputSource: input.inputSource, parameterId: '' };
			case 'nodesEffectCustomParameterValueReference': return { inputSource: input.inputSource, parameterId: '' };
			case 'node': return { inputSource: 'node', nodeId: null, outputPort: null };
			default: throw new Error('Unsupported Nodes Effect parameter input source');
		}
	},
	{ kind: 'inputSource', preserveModifier: true },
);
const setNodesEffectNodeParameterExpressionModifier = defineNodeParameterCommand<NodesEffectNodeParameterReference & { expressionModifier: ParameterExpressionModifier | null }>(
	'Set Nodes Effect node parameter expression modifier',
	(parameter, input) => {
		if (!supportsParameterExpressionModifier(parameter.def, parameter.value)) throw new Error('Expression modifier is not available for this parameter');
		return { ...parameter.value, expressionModifier: deepClone(input.expressionModifier) };
	},
);
const replaceNodesEffectNodeParameterBinding = defineNodeParameterCommand<NodesEffectNodeParameterReference & { binding: NodesEffectParameterBinding; connectionTypePolicy?: ConnectionTypePolicy | null }>(
	'Replace Nodes Effect node parameter binding', (_parameter, input) => deepClone(input.binding),
);
const resetNodesEffectNodeParameter = defineNodeParameterCommand<NodesEffectNodeParameterReference>(
	'Reset Nodes Effect node parameter', parameter => createResetParameterBinding(parameter.def), { kind: 'reset' },
);
const resetNodesEffectNodeParameters = defineCommand<{ target: NodesEffectNodeReference }>({
	label: 'Reset Nodes Effect node parameters',
	prepare(state, { target }) {
		const node = getNodesEffectEffectNode(state, target);
		const { paramDefs } = getEffectDefinitions(state).describe(node.effectSource);
		const defaultParams = Object.fromEntries(Object.entries(paramDefs).map(([key, definition]) => {
			const binding = node.params[key];
			// 既定値の配列は要素IDを維持し、リセットを繰り返したときに不要な履歴を作らない。
			return [key, isParameterBindingDefault(definition, binding) ? binding : createResetParameterBinding(definition)];
		}));
		return prepareNodesEffectValue(node.params, defaultParams,
			(currentState, value) => { getNodesEffectEffectNode(currentState, target).params = value; },
			[{ type: 'node', target: target.nodesEffect, nodeId: target.nodeId, changes: [{ type: 'parameter', kind: 'reset' }] }]);
	},
});
const setNodesEffectNodeParameterFields = defineNodeParameterCommand<NodesEffectNodeParameterReference & { fields: StructParameterFieldBindings }>(
	'Set Nodes Effect node parameter fields', (parameter, input) => updateStructParameterFields(parameter.def, parameter.value, input.fields),
);
const insertNodesEffectNodeParameterArrayElement = defineCommand<NodesEffectNodeParameterReference & { beforeElementId?: string | null }, NodesEffectNodeParameterReference>({
	label: 'Insert Nodes Effect node parameter array element',
	prepare(state, input) {
		const parameter = resolveNodeParam(getNodesEffectEffectNode(state, input.target), input.parameterPath, getEffectDefinitions(state));
		if (!isParameterType(parameter.def, 'array') || parameter.value.inputSource !== 'literal' || !Array.isArray(parameter.value.value)) throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<NodesEffectParameterBinding>[];
		if (parameter.def.maxElements != null && elements.length >= parameter.def.maxElements) throw new Error('Array parameter element limit reached');
		const index = input.beforeElementId == null ? elements.length : elements.findIndex(element => element.id === input.beforeElementId);
		if (index < 0) throw new Error('Array element not found');
		const element = { id: genId(), binding: createResetParameterBinding(getArrayElementDefinition(parameter.def)) };
		const after = deepClone(elements);
		after.splice(index, 0, element);
		return prepareNodesEffectValue(parameter.value, { inputSource: 'literal', value: after } as NodesEffectParameterBinding,
			(currentState, value) => resolveNodeParam(getNodesEffectEffectNode(currentState, input.target), input.parameterPath, getEffectDefinitions(currentState)).setValue(value),
			parameterChanges(input, 'arrayElements'), { target: input.target, parameterPath: [...input.parameterPath, element.id] });
	},
});
const removeNodesEffectNodeParameterArrayElements = defineNodeParameterCommand<NodesEffectNodeParameterReference & { elementIds: string[] }>(
	'Remove Nodes Effect node parameter array elements',
	(parameter, input) => {
		if (parameter.def.dataType.kind !== 'array' || parameter.value.inputSource !== 'literal' || !Array.isArray(parameter.value.value)) throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<NodesEffectParameterBinding>[];
		if (input.elementIds.some(id => !elements.some(element => element.id === id))) throw new Error('Array element not found');
		return { inputSource: 'literal', value: elements.filter(element => !input.elementIds.includes(element.id)) };
	},
	{ kind: 'arrayElements' },
);

const setNodesEffectNodeBypass = defineCommand<{ target: NodesEffectNodeReference; bypass: boolean }>({
	label: 'Set Nodes Effect node bypass',
	prepare(state, input) {
		if (typeof input.bypass !== 'boolean') throw new Error('Bypass must be a boolean');
		return prepareNodesEffectValue(getNodesEffectEffectNode(state, input.target).isBypass, input.bypass,
			(currentState, value) => { getNodesEffectEffectNode(currentState, input.target).isBypass = value; },
			[{ type: 'node', target: input.target.nodesEffect, nodeId: input.target.nodeId, changes: [{ type: 'bypass' }] }]);
	},
});
const setNodesEffectNodeDisplayName = defineCommand<{ target: NodesEffectNodeReference; displayName: string }>({
	label: 'Set Nodes Effect node display name',
	prepare(state, input) {
		if (typeof input.displayName !== 'string') throw new Error('Display name must be a string');
		const { nodesEffect, nodeId } = input.target;
		const getNode = (currentState: ProjectState) => {
			const node = stateUtility.findNode(currentState, { ...nodesEffect, nodeId });
			if (node?.type !== 'effect' && node?.type !== 'relay') throw new Error('Nodes Effect effect or relay node not found');
			return node;
		};
		const node = getNode(state);
		const before = node.type === 'effect' ? node.displayName : node.label ?? null;
		const after = node.type === 'relay' && input.displayName === '' ? null : input.displayName;
		return prepareNodesEffectValue(before, after, (currentState, displayName) => {
			const currentNode = getNode(currentState);
			if (currentNode.type === 'effect') currentNode.displayName = displayName ?? '';
			else if (displayName == null) delete currentNode.label;
			else currentNode.label = displayName;
		}, [{ type: 'nodeName', target: nodesEffect, nodeId }]);
	},
});
const setNodesEffectNodeStaticSetting = defineCommand<{ target: NodesEffectNodeReference; key: string; value: string | number | boolean | null }>({
	label: 'Set Nodes Effect node static setting',
	prepare(state, input) {
		const node = getNodesEffectEffectNode(state, input.target);
		const definition = getEffectDefinitions(state).describe(node.effectSource).staticSettingDefs?.[input.key];
		if (definition == null) throw new Error('Static setting not found');
		validateStaticSettingValue(definition, input.value);
		return prepareNodesEffectValue(node.staticSettings, { ...node.staticSettings, [input.key]: input.value },
			(currentState, value) => { getNodesEffectEffectNode(currentState, input.target).staticSettings = value; },
			[{ type: 'node', target: input.target.nodesEffect, nodeId: input.target.nodeId, changes: [{ type: 'staticSetting' }] }]);
	},
});
const setNodesEffectNodeResolution = defineCommand<{ target: NodesEffectNodeReference; resolution: NodesEffectEffectNode['resolution'] }>({
	label: 'Set Nodes Effect node resolution',
	prepare(state, input) {
		validateEffectResolution(input.resolution);
		return prepareNodesEffectValue(getNodesEffectEffectNode(state, input.target).resolution, input.resolution,
			(currentState, value) => { getNodesEffectEffectNode(currentState, input.target).resolution = value; },
			[{ type: 'node', target: input.target.nodesEffect, nodeId: input.target.nodeId, changes: [{ type: 'resolution' }] }]);
	},
});
const setNodesEffectOutputConnection = defineCommand<{ target: NodesEffectOutputReference; source: { nodeId: string; outputPort: string } | null; connectionTypePolicy?: ConnectionTypePolicy | null }>({
	label: 'Set Nodes Effect output connection',
	prepare(state, input) {
		const nodesEffect = getNodesEffect(state, input.target.nodesEffect);
		const outputDefinition = nodesEffect.outputDefs.find(definition => definition.id === input.target.outputId);
		if (outputDefinition == null) throw new Error('Nodes Effect output not found');
		const getOutputNode = (currentState: ProjectState) => {
			const node = getNodesEffect(currentState, input.target.nodesEffect).nodes.find(candidate => candidate.type === 'globalOut');
			if (node?.type !== 'globalOut') throw new Error('Global output node not found');
			return node;
		};
		if (input.source != null) {
			const source = nodesEffect.nodes.find(candidate => candidate.id === input.source!.nodeId);
			const output = getNodeOutputs(source, nodesEffect.paramDefs, getEffectDefinitions(state))[input.source.outputPort];
			if (output == null) throw new Error('Node output not found in this Nodes Effect');
			if (!canConnectNodeDataTypes(output.dataType, outputDefinition.dataType, input.connectionTypePolicy ?? 'strict')) throw new Error('Node output type does not match the Nodes Effect output');
		}
		const before = getOutputNode(state).inputs[input.target.outputId] ?? null;
		const after = input.source ?? (before?.nodeId == null ? before : { nodeId: null, outputPort: null });
		return prepareNodesEffectValue(before, after,
			(currentState, value) => {
				if (value == null) delete getOutputNode(currentState).inputs[input.target.outputId];
				else getOutputNode(currentState).inputs[input.target.outputId] = value;
			}, [{ type: 'nodesEffect', target: input.target.nodesEffect }]);
	},
});

function validateNodesEffectPublicParameterDefinition(nodesEffect: NodesEffect, definition: NodesEffectParamDef, previousId?: string) {
	if (isParameterType(definition, 'enum')) {
		const options = definition.dataType.options;
		if (options.length === 0 || options.some(value => value.trim() === '') || new Set(options).size !== options.length) throw new Error('Enum options must be non-empty and unique');
	}
	validateParameterDefaultValues(definition);
	if (definition.canNode && !isTextureDataType(definition.dataType)) throw new Error('Only node-capable parameter types can be exposed as In node outputs');
	if (nodesEffect.paramDefs.some(item => item.id !== previousId && (item.id === definition.id || item.nameForReference === definition.nameForReference))) throw new Error('Parameter ID and name must be unique');
}

function validateCustomParameterDefinition(nodesEffect: NodesEffect, definition: NodesEffectCustomParameterDefinition, previousId?: string) {
	validateNodesEffectCustomParameterDefinition(definition);
	if (nodesEffect.customParameterDefs.some(candidate => candidate.id !== previousId && (candidate.id === definition.id || candidate.nameForReference === definition.nameForReference))) throw new Error('Custom parameter ID and name must be unique');
}

function validateOutputDefinition(nodesEffect: NodesEffect, definition: NodesEffectOutputDef, previousId?: string) {
	if (!isTextureDataType(definition.dataType)) throw new Error('Nodes Effect output must have a texture data type');
	if (nodesEffect.outputDefs.some(item => item.id !== previousId && (item.id === definition.id || item.name === definition.name))) throw new Error('Output ID and name must be unique');
}

const setNodesEffectPrimaryInput = defineCommand<{ target: NodesEffectTarget; primaryInputId: string | null }>({
	label: 'Set Nodes Effect primary input',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target, ['primaryInputId'], nodesEffect => {
		if (input.primaryInputId !== null && !nodesEffect.paramDefs.some(definition => definition.id === input.primaryInputId && definition.canNode && definition.dataType.kind === 'color')) throw new Error('Primary input must reference a node-capable color parameter');
		nodesEffect.primaryInputId = input.primaryInputId;
	}),
});
const setNodesEffectPrimaryAudioInput = defineCommand<{ target: NodesEffectTarget; primaryAudioInputId: string | null }>({
	label: 'Set Nodes Effect primary audio input',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target, ['primaryAudioInputId'], nodesEffect => {
		if (input.primaryAudioInputId !== null && !nodesEffect.paramDefs.some(definition => definition.id === input.primaryAudioInputId && !definition.canNode && definition.dataType.kind === 'audioSource')) throw new Error('Primary audio input must reference an audio parameter');
		nodesEffect.primaryAudioInputId = input.primaryAudioInputId;
	}),
});
const setNodesEffectPrimaryOutput = defineCommand<{ target: NodesEffectTarget; primaryOutputId: string | null }>({
	label: 'Set Nodes Effect primary output',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target, ['primaryOutputId'], nodesEffect => {
		if (input.primaryOutputId !== null && !nodesEffect.outputDefs.some(definition => definition.id === input.primaryOutputId && definition.dataType.kind === 'color')) throw new Error('Primary output must reference a color output');
		nodesEffect.primaryOutputId = input.primaryOutputId;
	}),
});

const createNodesEffectPublicParameter = defineCommand<{ nodesEffect: NodesEffectTarget; definition: Omit<NodesEffectParamDef, 'id'> }, NodesEffectPublicParameterReference>({
	label: 'Create Nodes Effect public parameter',
	prepare: (state, input) => prepareNodesEffectFields(state, input.nodesEffect, ['paramDefs'], nodesEffect => {
		const definition = { ...deepClone(input.definition), id: genId() } as NodesEffectParamDef;
		validateNodesEffectPublicParameterDefinition(nodesEffect, definition);
		nodesEffect.paramDefs.push(definition);
		return { nodesEffect: input.nodesEffect, parameterId: definition.id };
	}),
});
const replaceNodesEffectPublicParameterDefinition = defineCommand<{ target: NodesEffectPublicParameterReference; definition: Omit<NodesEffectParamDef, 'id'> }>({
	label: 'Replace Nodes Effect public parameter definition',
	prepare(state, { target: { nodesEffect: target, parameterId }, definition: replacement }) {
		const { paramDefs } = getNodesEffect(state, target);
		const index = paramDefs.findIndex(definition => definition.id === parameterId);
		if (index < 0) throw new Error('Nodes Effect public parameter not found');
		const definition = { ...deepClone(replacement), id: parameterId } as NodesEffectParamDef;
		const prepared = prepareNodesEffectFields(state, target, ['paramDefs', 'primaryInputId', 'primaryAudioInputId', 'resolutionInputParameters'], nodesEffect => {
			validateNodesEffectPublicParameterDefinition(nodesEffect, definition, parameterId);
			nodesEffect.paramDefs[index] = definition;
			if (nodesEffect.primaryInputId === parameterId && (!definition.canNode || definition.dataType.kind !== 'color')) nodesEffect.primaryInputId = null;
			if (nodesEffect.primaryAudioInputId === parameterId && (definition.canNode || definition.dataType.kind !== 'audioSource')) nodesEffect.primaryAudioInputId = null;
		});
		return includeNodesEffectPublicArgumentChanges(state, target, parameterId, prepared, { previous: paramDefs[index], next: definition });
	},
});

const removeNodesEffectPublicParameter = defineCommand<{ target: NodesEffectPublicParameterReference }>({
	label: 'Remove Nodes Effect public parameter',
	prepare(state, { target: { nodesEffect: target, parameterId } }) {
		const prepared = prepareNodesEffectFields(state, target, ['paramDefs', 'primaryInputId', 'primaryAudioInputId', 'resolutionInputParameters'], nodesEffect => {
			const index = nodesEffect.paramDefs.findIndex(definition => definition.id === parameterId);
			if (index < 0) throw new Error('Nodes Effect public parameter not found');
			nodesEffect.paramDefs.splice(index, 1);
			if (nodesEffect.primaryInputId === parameterId) nodesEffect.primaryInputId = null;
			if (nodesEffect.primaryAudioInputId === parameterId) nodesEffect.primaryAudioInputId = null;
			// 定義内部から公開入力への配線は未解決のまま保持する。取り除くのは配置側が渡す引数だけ。
		});
		return includeNodesEffectPublicArgumentChanges(state, target, parameterId, prepared, null);
	},
});
const createNodesEffectCustomParameter = defineCommand<{ nodesEffect: NodesEffectTarget; definition: Omit<NodesEffectCustomParameterDefinition, 'id'> }, NodesEffectCustomParameterReference>({
	label: 'Create Nodes Effect custom parameter',
	prepare: (state, input) => prepareNodesEffectFields(state, input.nodesEffect, ['customParameterDefs'], nodesEffect => {
		const definition = { ...deepClone(input.definition), id: genId() } as NodesEffectCustomParameterDefinition;
		validateCustomParameterDefinition(nodesEffect, definition);
		nodesEffect.customParameterDefs.push(definition);
		return { nodesEffect: input.nodesEffect, parameterId: definition.id };
	}),
});
const replaceNodesEffectCustomParameterDefinition = defineCommand<{ target: NodesEffectCustomParameterReference; definition: Omit<NodesEffectCustomParameterDefinition, 'id'> }>({
	label: 'Replace Nodes Effect custom parameter definition',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target.nodesEffect, ['customParameterDefs', 'customParameterValues'], nodesEffect => {
		const index = nodesEffect.customParameterDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Nodes Effect custom parameter not found');
		const definition = { ...deepClone(input.definition), id: input.target.parameterId } as NodesEffectCustomParameterDefinition;
		validateCustomParameterDefinition(nodesEffect, definition, input.target.parameterId);
		if (nodesEffect.customParameterDefs[index].dataType.kind !== definition.dataType.kind) delete nodesEffect.customParameterValues[definition.id];
		validateNodesEffectCustomParameterBinding(definition, nodesEffect.customParameterValues[definition.id] ?? createDefaultParameterBinding(definition));
		nodesEffect.customParameterDefs[index] = definition;
	}),
});
const removeNodesEffectCustomParameter = defineCommand<{ target: NodesEffectCustomParameterReference }>({
	label: 'Remove Nodes Effect custom parameter',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target.nodesEffect, ['customParameterDefs', 'customParameterValues'], nodesEffect => {
		const index = nodesEffect.customParameterDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Nodes Effect custom parameter not found');
		nodesEffect.customParameterDefs.splice(index, 1);
		delete nodesEffect.customParameterValues[input.target.parameterId];
	}),
});

const createNodesEffectPublicParameterFromParameter = defineCommand<NodesEffectNodeParameterReference, NodesEffectPublicParameterReference>({
	label: 'Create and connect Nodes Effect public parameter',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target.nodesEffect, ['paramDefs', 'nodes'], nodesEffect => {
		const node = nodesEffect.nodes.find(candidate => candidate.id === input.target.nodeId);
		if (node?.type !== 'effect') throw new Error('Effect node not found');
		const parameter = resolveNodeParam(node, input.parameterPath, getEffectDefinitions(state));
		const named = createNamedParameterFromLiteral(parameter.def, parameter.value, nodesEffect.paramDefs);
		const definition: NodesEffectParamDef = { ...named, id: genId(), nameForReference: named.nameForReference };
		validateNodesEffectPublicParameterDefinition(nodesEffect, definition);
		nodesEffect.paramDefs.push(definition);
		parameter.setValue({ inputSource: 'nodesEffectPublicParameterReference', parameterId: definition.id });
		return { nodesEffect: input.target.nodesEffect, parameterId: definition.id };
	}),
});
const createNodesEffectCustomParameterFromParameter = defineCommand<NodesEffectNodeParameterReference, NodesEffectCustomParameterReference>({
	label: 'Create and connect Nodes Effect custom parameter',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target.nodesEffect, ['customParameterDefs', 'nodes'], nodesEffect => {
		const node = nodesEffect.nodes.find(candidate => candidate.id === input.target.nodeId);
		if (node?.type !== 'effect') throw new Error('Effect node not found');
		const parameter = resolveNodeParam(node, input.parameterPath, getEffectDefinitions(state));
		const named = createNamedParameterFromLiteral(parameter.def, parameter.value, nodesEffect.customParameterDefs);
		const definition: NodesEffectCustomParameterDefinition = { ...named, id: genId(), nameForReference: named.nameForReference };
		validateCustomParameterDefinition(nodesEffect, definition);
		nodesEffect.customParameterDefs.push(definition);
		parameter.setValue({ inputSource: 'nodesEffectCustomParameterValueReference', parameterId: definition.id });
		return { nodesEffect: input.target.nodesEffect, parameterId: definition.id };
	}),
});

function defineCustomParameterCommand<Input extends { target: NodesEffectCustomParameterReference }>(label: string,
	update: (definition: NodesEffectCustomParameterDefinition, current: NodesEffectValueParameterBinding, input: Input) => NodesEffectValueParameterBinding | null,
	autoMerge = false,
) {
	return defineCommand<Input>({
		label,
		getAutoMergeKey: input => {
			const source = 'source' in input ? input.source as NodesEffectCustomParameterSource : null;
			return autoMerge && (source?.inputSource === 'literal' || source?.inputSource === 'expression')
				? JSON.stringify([nodesEffectTargetKey(input.target.nodesEffect), input.target.parameterId, source.inputSource]) : null;
		},
		prepare(state, input) {
			const nodesEffect = getNodesEffect(state, input.target.nodesEffect);
			const definition = nodesEffect.customParameterDefs.find(candidate => candidate.id === input.target.parameterId);
			if (definition == null) throw new Error('Nodes Effect custom parameter not found');
			const before = nodesEffect.customParameterValues[input.target.parameterId] ?? null;
			const defaultBinding = createDefaultParameterBinding(definition);
			const after = update(definition, deepClone(before ?? defaultBinding), input);
			validateNodesEffectCustomParameterBinding(definition, after ?? defaultBinding);
			const customParameterValuesOnly = getParameterBindingChangeKind(definition, before ?? defaultBinding, after ?? defaultBinding) === 'value';
			return prepareNodesEffectValue(before, after, (currentState, value) => {
				const current = getNodesEffect(currentState, input.target.nodesEffect);
				if (value == null) delete current.customParameterValues[input.target.parameterId];
				else current.customParameterValues[input.target.parameterId] = value;
			}, [{ type: 'nodesEffect', target: input.target.nodesEffect, customParameterValuesOnly }]);
		},
	});
}

const setNodesEffectCustomParameterSource = defineCustomParameterCommand<{ target: NodesEffectCustomParameterReference; source: NodesEffectCustomParameterSource }>(
	'Set Nodes Effect custom parameter source', (_definition, current, input) => {
		const source = deepClone(input.source);
		if ('expressionModifier' in source) delete source.expressionModifier;
		return preserveParameterExpressionModifier(current, source);
	}, true,
);
const switchNodesEffectCustomParameterInputSource = defineCustomParameterCommand<{ target: NodesEffectCustomParameterReference; inputSource: NodesEffectValueParameterBinding['inputSource'] }>(
	'Switch Nodes Effect custom parameter input source', (definition, current, input) => editNodesEffectCustomParameterBinding(definition, current, { kind: 'inputSource', inputSource: input.inputSource }),
);
const setNodesEffectCustomParameterExpressionModifier = defineCustomParameterCommand<{ target: NodesEffectCustomParameterReference; expressionModifier: ParameterExpressionModifier | null }>(
	'Set Nodes Effect custom parameter expression modifier', (definition, current, input) => {
		if (!supportsParameterExpressionModifier(definition, current)) throw new Error('Expression modifier is not available for this parameter');
		return { ...current, expressionModifier: deepClone(input.expressionModifier) };
	},
);
const replaceNodesEffectCustomParameterBinding = defineCustomParameterCommand<{ target: NodesEffectCustomParameterReference; binding: NodesEffectValueParameterBinding }>(
	'Replace Nodes Effect custom parameter binding', (_definition, _current, input) => deepClone(input.binding),
);
const resetNodesEffectCustomParameter = defineCustomParameterCommand<{ target: NodesEffectCustomParameterReference }>(
	'Reset Nodes Effect custom parameter', () => null,
);

const createNodesEffectOutput = defineCommand<{ nodesEffect: NodesEffectTarget; definition: Omit<NodesEffectOutputDef, 'id'> }, NodesEffectOutputReference>({
	label: 'Create Nodes Effect output',
	prepare: (state, input) => prepareNodesEffectFields(state, input.nodesEffect, ['outputDefs', 'primaryOutputId'], nodesEffect => {
		const definition = { ...deepClone(input.definition), id: genId() };
		validateOutputDefinition(nodesEffect, definition);
		nodesEffect.outputDefs.push(definition);
		if (nodesEffect.primaryOutputId == null && definition.dataType.kind === 'color') nodesEffect.primaryOutputId = definition.id;
		return { nodesEffect: input.nodesEffect, outputId: definition.id };
	}),
});
const replaceNodesEffectOutputDefinition = defineCommand<{ target: NodesEffectOutputReference; definition: Omit<NodesEffectOutputDef, 'id'> }>({
	label: 'Replace Nodes Effect output definition',
	prepare: (state, input) => prepareNodesEffectFields(state, input.target.nodesEffect, ['outputDefs', 'primaryOutputId'], nodesEffect => {
		const index = nodesEffect.outputDefs.findIndex(definition => definition.id === input.target.outputId);
		if (index < 0) throw new Error('Nodes Effect output not found');
		const definition = { ...deepClone(input.definition), id: input.target.outputId };
		validateOutputDefinition(nodesEffect, definition, input.target.outputId);
		nodesEffect.outputDefs[index] = definition;
		if (nodesEffect.primaryOutputId === definition.id && definition.dataType.kind !== 'color') nodesEffect.primaryOutputId = null;
	}),
});

function prepareRegisteredNodesEffectOutputDisconnections(state: ProjectState, nodesEffectId: string, outputId: string) {
	const definitions = getEffectDefinitions(state);
	return prepareProjectEffectPlacementChanges(state, {
		nodesEffect(nodesEffect) {
			const sourceNodeIds = new Set(nodesEffect.nodes.flatMap(node => node.type !== 'relay'
				&& node.effectSource.type === 'nodesEffectReference' && node.effectSource.id === nodesEffectId ? [node.id] : []));
			if (sourceNodeIds.size === 0) return null;
			// ノードIDはグラフ内だけで有効。残る出力やRelayの出力自体への配線は切断しない。
			const usesRemovedOutput = (source: NodesEffectOutputSource | null | undefined): source is NodeOutputReference =>
				source != null && 'nodeId' in source && source.outputPort === outputId && sourceNodeIds.has(source.nodeId);
			const outputConnections = Object.entries(nodesEffect.outputSources).flatMap(([id, source]) => usesRemovedOutput(source) ? [[id, { ...source }] as const] : []);
			const relayInputs = new Map<string, NodeOutputReference>();
			const parameterEdits = new Map<string, (params: StoredNodesEffectEffectNode['params'], restore: boolean) => void>();
			for (const node of nodesEffect.nodes) {
				if (node.type === 'relay') {
					if (usesRemovedOutput(node.input)) relayInputs.set(node.id, { ...node.input });
					continue;
				}
				if (Object.keys(node.params).length === 0) continue;
				const { paramDefs } = resolveEffectSource(node.effectSource, definitions).definition;
				const parameterConnections: { path: ParamPath; binding: Extract<StoredNodesEffectParameterBinding, { inputSource: 'node' }> }[] = [];
				for (const { path, value } of walkParameters<StoredNodesEffectParameterBinding>(paramDefs, node.params)) {
					if (value.inputSource === 'node' && usesRemovedOutput(value.source)) parameterConnections.push({ path, binding: deepClone(value) });
				}
				if (parameterConnections.length === 0) continue;
				parameterEdits.set(node.id, (params, restore) => {
					for (const { path, binding } of parameterConnections) {
						resolveParameter<StoredNodesEffectParameterBinding>(paramDefs, params, path).setValue(deepClone(restore ? binding : { ...binding, source: null }));
					}
				});
			}
			if (outputConnections.length === 0 && relayInputs.size === 0 && parameterEdits.size === 0) return null;
			return (current, restore) => {
				if (outputConnections.length > 0) {
					const outputSources = new Map(Object.entries(current.outputSources));
					for (const [id, source] of outputConnections) {
						if (restore) outputSources.set(id, { ...source });
						else outputSources.delete(id);
					}
					Object.assign(current, { outputSources: Object.fromEntries(outputSources) });
				}
				for (const node of current.nodes) {
					if (node.type !== 'relay') parameterEdits.get(node.id)?.(node.params, restore);
					else {
						const input = relayInputs.get(node.id);
						if (input != null) Object.assign(node, { input: restore ? { ...input } : null });
					}
				}
			};
		},
	});
}

const removeNodesEffectOutput = defineCommand<{ target: NodesEffectOutputReference }>({
	label: 'Remove Nodes Effect output',
	prepare(state, { target }) {
		const nodesEffect = getNodesEffect(state, target.nodesEffect);
		if (!nodesEffect.outputDefs.some(output => output.id === target.outputId)) throw new Error('Nodes Effect output not found');
		const out = nodesEffect.nodes.find(node => node.type === 'globalOut')!;
		const before = { outputDefs: nodesEffect.outputDefs, primaryOutputId: nodesEffect.primaryOutputId, source: Object.hasOwn(out.inputs, target.outputId) ? out.inputs[target.outputId] : null };
		const after = { outputDefs: nodesEffect.outputDefs.filter(output => output.id !== target.outputId),
			primaryOutputId: nodesEffect.primaryOutputId === target.outputId ? null : nodesEffect.primaryOutputId, source: null };
		// 削除した出力の配線だけを定義と一緒に履歴へ残し、Undoで同じポートに戻す。
		const prepared = prepareNodesEffectValue(before, after, (currentState, value) => {
			const current = getNodesEffect(currentState, target.nodesEffect);
			current.outputDefs = value.outputDefs;
			current.primaryOutputId = value.primaryOutputId;
			const outputNode = current.nodes.find(node => node.type === 'globalOut')!;
			if (value.source == null) delete outputNode.inputs[target.outputId];
			else outputNode.inputs = { ...outputNode.inputs, [target.outputId]: value.source };
		}, [{ type: 'nodesEffect', target: target.nodesEffect }]);
		const { change } = prepared;
		if (change == null || !('nodesEffectId' in target.nodesEffect)) return prepared;
		const disconnections = prepareRegisteredNodesEffectOutputDisconnections(state, target.nodesEffect.nodesEffectId, target.outputId);
		return { result: prepared.result, change: {
			changes: [...disconnections.changes, ...change.changes],
			// 削除時は配線から先に外し、Undo時はポートが存在する状態へ戻してから配線し直す。
			apply(current) { disconnections.apply(current); change.apply(current); },
			revert(current) { change.revert(current); disconnections.revert(current); },
		} };
	},
});

export const NODES_EFFECT_PARAMETERS_COMMAND_DEFS = {
	setNodesEffectNodeParameterSource: withCommandContract(setNodesEffectNodeParameterSource, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectNodeParameterSource),
	switchNodesEffectNodeParameterInputSource: withCommandContract(switchNodesEffectNodeParameterInputSource, NODES_EFFECT_PARAMETER_CONTRACTS.switchNodesEffectNodeParameterInputSource),
	setNodesEffectNodeParameterExpressionModifier: withCommandContract(setNodesEffectNodeParameterExpressionModifier, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectNodeParameterExpressionModifier),
	replaceNodesEffectNodeParameterBinding: withCommandContract(replaceNodesEffectNodeParameterBinding, NODES_EFFECT_PARAMETER_CONTRACTS.replaceNodesEffectNodeParameterBinding),
	resetNodesEffectNodeParameter: withCommandContract(resetNodesEffectNodeParameter, NODES_EFFECT_PARAMETER_CONTRACTS.resetNodesEffectNodeParameter),
	resetNodesEffectNodeParameters,
	setNodesEffectNodeParameterFields: withCommandContract(setNodesEffectNodeParameterFields, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectNodeParameterFields),
	insertNodesEffectNodeParameterArrayElement: withCommandContract(insertNodesEffectNodeParameterArrayElement, NODES_EFFECT_PARAMETER_CONTRACTS.insertNodesEffectNodeParameterArrayElement),
	removeNodesEffectNodeParameterArrayElements: withCommandContract(removeNodesEffectNodeParameterArrayElements, NODES_EFFECT_PARAMETER_CONTRACTS.removeNodesEffectNodeParameterArrayElements),
	setNodesEffectNodeBypass: withCommandContract(setNodesEffectNodeBypass, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectNodeBypass),
	setNodesEffectNodeDisplayName: withCommandContract(setNodesEffectNodeDisplayName, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectNodeDisplayName),
	setNodesEffectNodeStaticSetting: withCommandContract(setNodesEffectNodeStaticSetting, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectNodeStaticSetting),
	setNodesEffectNodeResolution: withCommandContract(setNodesEffectNodeResolution, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectNodeResolution),
	setNodesEffectOutputConnection: withCommandContract(setNodesEffectOutputConnection, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectOutputConnection),
	setNodesEffectPrimaryInput: withCommandContract(setNodesEffectPrimaryInput, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectPrimaryInput),
	setNodesEffectPrimaryAudioInput: withCommandContract(setNodesEffectPrimaryAudioInput, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectPrimaryAudioInput),
	setNodesEffectPrimaryOutput: withCommandContract(setNodesEffectPrimaryOutput, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectPrimaryOutput),
	createNodesEffectPublicParameter: withCommandContract(createNodesEffectPublicParameter, NODES_EFFECT_PARAMETER_CONTRACTS.createNodesEffectPublicParameter),
	replaceNodesEffectPublicParameterDefinition: withCommandContract(replaceNodesEffectPublicParameterDefinition, NODES_EFFECT_PARAMETER_CONTRACTS.replaceNodesEffectPublicParameterDefinition),
	removeNodesEffectPublicParameter: withCommandContract(removeNodesEffectPublicParameter, NODES_EFFECT_PARAMETER_CONTRACTS.removeNodesEffectPublicParameter),
	createNodesEffectPublicParameterFromParameter: withCommandContract(createNodesEffectPublicParameterFromParameter, NODES_EFFECT_PARAMETER_CONTRACTS.createNodesEffectPublicParameterFromParameter),
	createNodesEffectCustomParameterFromParameter: withCommandContract(createNodesEffectCustomParameterFromParameter, NODES_EFFECT_PARAMETER_CONTRACTS.createNodesEffectCustomParameterFromParameter),
	createNodesEffectCustomParameter: withCommandContract(createNodesEffectCustomParameter, NODES_EFFECT_PARAMETER_CONTRACTS.createNodesEffectCustomParameter),
	replaceNodesEffectCustomParameterDefinition: withCommandContract(replaceNodesEffectCustomParameterDefinition, NODES_EFFECT_PARAMETER_CONTRACTS.replaceNodesEffectCustomParameterDefinition),
	removeNodesEffectCustomParameter: withCommandContract(removeNodesEffectCustomParameter, NODES_EFFECT_PARAMETER_CONTRACTS.removeNodesEffectCustomParameter),
	setNodesEffectCustomParameterSource: withCommandContract(setNodesEffectCustomParameterSource, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectCustomParameterSource),
	switchNodesEffectCustomParameterInputSource: withCommandContract(switchNodesEffectCustomParameterInputSource, NODES_EFFECT_PARAMETER_CONTRACTS.switchNodesEffectCustomParameterInputSource),
	setNodesEffectCustomParameterExpressionModifier: withCommandContract(setNodesEffectCustomParameterExpressionModifier, NODES_EFFECT_PARAMETER_CONTRACTS.setNodesEffectCustomParameterExpressionModifier),
	replaceNodesEffectCustomParameterBinding: withCommandContract(replaceNodesEffectCustomParameterBinding, NODES_EFFECT_PARAMETER_CONTRACTS.replaceNodesEffectCustomParameterBinding),
	resetNodesEffectCustomParameter: withCommandContract(resetNodesEffectCustomParameter, NODES_EFFECT_PARAMETER_CONTRACTS.resetNodesEffectCustomParameter),
	createNodesEffectOutput: withCommandContract(createNodesEffectOutput, NODES_EFFECT_PARAMETER_CONTRACTS.createNodesEffectOutput),
	replaceNodesEffectOutputDefinition: withCommandContract(replaceNodesEffectOutputDefinition, NODES_EFFECT_PARAMETER_CONTRACTS.replaceNodesEffectOutputDefinition),
	removeNodesEffectOutput: withCommandContract(removeNodesEffectOutput, NODES_EFFECT_PARAMETER_CONTRACTS.removeNodesEffectOutput),
};
