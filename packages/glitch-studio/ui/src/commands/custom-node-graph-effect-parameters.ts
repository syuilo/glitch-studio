import { AiSON } from '@syuilo/aiscript';
import { validateStaticSettingValue } from '@gs/shared/static-setting.ts';
import { preserveParameterExpressionModifier, supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import { getArrayElementDefinition, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { customNodeGraphEffectTargetKey } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { validateCustomNodeGraphEffectCustomParameterDefinition, validateCustomNodeGraphEffectCustomParameterBinding } from '@gs/subsystems_custom-node-graph-effect_shared/custom-parameters.ts';
import { customNodeGraphEffectPublicParameterId, customNodeGraphEffectPublicParameterName, customNodeGraphEffectCustomParameterId, customNodeGraphEffectCustomParameterName } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import { getNodeOutputs } from '@gs/subsystems_custom-node-graph-effect_shared/node-outputs.ts';
import { updateStructParameterFields } from '../utility/struct-parameter-edit.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { getCustomNodeGraphEffect } from '../utility/custom-node-graph-effect-target.ts';
import { createResetParameterBinding } from '../utility/parameter-default.ts';
import { createInlineKeyframesTimeline } from '../utility/keyframes-timeline.ts';
import { createInlineAutomationGraph } from '../utility/automation-graph.ts';
import { resolveNodeParam } from '../utility/node-params.ts';
import { createNamedParameterFromLiteral } from '../utility/named-parameter-creation.ts';
import { editCustomNodeGraphEffectCustomParameterBinding } from '../utility/custom-node-graph-effect-custom-parameter-edit.ts';
import { validateCustomNodeGraphEffectNodeParameterBinding } from './custom-node-graph-effect-parameter-validation.ts';
import { getParameterBindingChangeKind } from './parameter-change.ts';
import { defineCommand, withCommandContract } from './definition.ts';
import { CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS } from './custom-node-graph-effect-parameter-contracts.ts';
import { canConnectCustomNodeGraphEffectTypes, stateUtility } from './custom-node-graph-effect.ts';
import { getCustomNodeGraphEffectEffectNode, prepareCustomNodeGraphEffectFields, prepareCustomNodeGraphEffectValue } from './custom-node-graph-effect-change.ts';
import type { StructParameterFieldBindings } from '../utility/struct-parameter-edit.ts';
import type { ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { CustomNodeGraphEffectCustomParameterDefinition, CustomNodeGraphEffectCustomParameterId, CustomNodeGraphEffectPublicParameterId, CustomNodeGraphEffectValueParameterBinding, CustomNodeGraphEffectParameterBinding, CustomNodeGraphEffectEffectNode, CustomNodeGraphEffect, CustomNodeGraphEffectParamDef, CustomNodeGraphEffectOutputDef } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectNodeReference } from './custom-node-graph-effect-change.ts';
import type { ConnectionTypePolicy } from './custom-node-graph-effect.ts';
import type { ProjectState, AppStateChange } from '../Project.ts';

export type CustomNodeGraphEffectNodeParameterReference = { target: CustomNodeGraphEffectNodeReference; parameterPath: ParamPath };
export type CustomNodeGraphEffectPublicParameterReference = { customNodeGraphEffect: CustomNodeGraphEffectTarget; parameterId: CustomNodeGraphEffectPublicParameterId };
export type CustomNodeGraphEffectCustomParameterReference = { customNodeGraphEffect: CustomNodeGraphEffectTarget; parameterId: CustomNodeGraphEffectCustomParameterId };
export type CustomNodeGraphEffectOutputReference = { customNodeGraphEffect: CustomNodeGraphEffectTarget; outputId: string };
type WithoutExpressionModifier<Value> = Value extends unknown ? Omit<Value, 'expressionModifier'> : never;
export type CustomNodeGraphEffectParameterSource = WithoutExpressionModifier<CustomNodeGraphEffectParameterBinding>;
export type CustomNodeGraphEffectCustomParameterSource = WithoutExpressionModifier<CustomNodeGraphEffectValueParameterBinding>;

function parameterChanges(input: CustomNodeGraphEffectNodeParameterReference, kind: ParameterChangeKind): AppStateChange[] {
	return [{ type: 'node', target: input.target.customNodeGraphEffect, nodeId: input.target.nodeId, changes: [{ type: 'parameter', kind }] }];
}

function defineNodeParameterCommand<Input extends CustomNodeGraphEffectNodeParameterReference>(
	label: string,
	update: (parameter: ReturnType<typeof resolveNodeParam>, input: Input) => CustomNodeGraphEffectParameterBinding,
	options: { kind?: ParameterChangeKind; preserveModifier?: boolean; autoMerge?: boolean } = {},
) {
	return defineCommand<Input>({
		label,
		getAutoMergeKey: input => {
			const source = 'source' in input ? input.source as CustomNodeGraphEffectParameterSource : null;
			return options.autoMerge === true && (source?.inputSource === 'literal' || source?.inputSource === 'expression')
				? JSON.stringify([customNodeGraphEffectTargetKey(input.target.customNodeGraphEffect), input.target.nodeId, input.parameterPath, source.inputSource]) : null;
		},
		prepare(state, input) {
			const parameter = resolveNodeParam(getCustomNodeGraphEffectEffectNode(state, input.target), input.parameterPath, getEffectDefinitions(state));
			// prepare中に更新関数へ渡す値も複製し、検証失敗でライブ状態を変更しない。
			const draftParameter = { ...parameter, value: deepClone(parameter.value) };
			const updated = update(draftParameter, input);
			const after = options.preserveModifier === true ? preserveParameterExpressionModifier(parameter.value, updated) : updated;
			const policy = 'connectionTypePolicy' in input ? input.connectionTypePolicy as ConnectionTypePolicy : 'strict';
			validateCustomNodeGraphEffectNodeParameterBinding(state, getCustomNodeGraphEffect(state, input.target.customNodeGraphEffect), parameter.def, after, policy, parameter.value);
			return prepareCustomNodeGraphEffectValue(parameter.value, after, (currentState, value) => {
				resolveNodeParam(getCustomNodeGraphEffectEffectNode(currentState, input.target), input.parameterPath, getEffectDefinitions(currentState)).setValue(value);
			}, parameterChanges(input, options.kind ?? getParameterBindingChangeKind(parameter.def, parameter.value, after)));
		},
	});
}

function assertLeafParameter(parameter: ReturnType<typeof resolveNodeParam>) {
	if (parameter.def.dataType.kind === 'array' || parameter.def.dataType.kind === 'struct') throw new Error('Struct and array containers cannot change input source');
}

const setCustomNodeGraphEffectNodeParameterSource = defineNodeParameterCommand<CustomNodeGraphEffectNodeParameterReference & {
	source: CustomNodeGraphEffectParameterSource; preserveNodeSampling?: boolean; connectionTypePolicy?: ConnectionTypePolicy;
}>(
	'Set Custom Node Graph Effect node parameter source',
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

const switchCustomNodeGraphEffectNodeParameterInputSource = defineNodeParameterCommand<CustomNodeGraphEffectNodeParameterReference & { inputSource: CustomNodeGraphEffectParameterBinding['inputSource'] }>(
	'Switch Custom Node Graph Effect node parameter input source',
	(parameter, input) => {
		assertLeafParameter(parameter);
		switch (input.inputSource) {
			case 'literal': return deepClone(parameter.def.defaultValue);
			case 'expression': return { inputSource: 'expression', expression: AiSON.stringify(parameter.value.inputSource === 'literal' ? parameter.value.value : parameter.def.defaultValue.value) };
			case 'envVariable': return { inputSource: 'envVariable', variable: '' };
			case 'automationGraphReference': return { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' };
			case 'automationGraphInline': return createInlineAutomationGraph();
			case 'keyframesTimelineInline': return createInlineKeyframesTimeline(parameter.def, parameter.value);
			case 'customNodeGraphEffectPublicParameterReference': return { inputSource: input.inputSource, parameterId: customNodeGraphEffectPublicParameterId('') };
			case 'customNodeGraphEffectCustomParameterValueReference': return { inputSource: input.inputSource, parameterId: customNodeGraphEffectCustomParameterId('') };
			case 'node': return { inputSource: 'node', nodeId: null, outputPort: null };
			default: throw new Error('Unsupported Custom Node Graph Effect parameter input source');
		}
	},
	{ kind: 'inputSource', preserveModifier: true },
);
const setCustomNodeGraphEffectNodeParameterExpressionModifier = defineNodeParameterCommand<CustomNodeGraphEffectNodeParameterReference & { expressionModifier: ParameterExpressionModifier | null }>(
	'Set Custom Node Graph Effect node parameter expression modifier',
	(parameter, input) => {
		if (!supportsParameterExpressionModifier(parameter.def, parameter.value)) throw new Error('Expression modifier is not available for this parameter');
		return { ...parameter.value, expressionModifier: deepClone(input.expressionModifier) };
	},
);
const replaceCustomNodeGraphEffectNodeParameterBinding = defineNodeParameterCommand<CustomNodeGraphEffectNodeParameterReference & { binding: CustomNodeGraphEffectParameterBinding; connectionTypePolicy?: ConnectionTypePolicy }>(
	'Replace Custom Node Graph Effect node parameter binding', (_parameter, input) => deepClone(input.binding),
);
const resetCustomNodeGraphEffectNodeParameter = defineNodeParameterCommand<CustomNodeGraphEffectNodeParameterReference>(
	'Reset Custom Node Graph Effect node parameter', parameter => createResetParameterBinding(parameter.def), { kind: 'reset' },
);
const setCustomNodeGraphEffectNodeParameterFields = defineNodeParameterCommand<CustomNodeGraphEffectNodeParameterReference & { fields: StructParameterFieldBindings }>(
	'Set Custom Node Graph Effect node parameter fields', (parameter, input) => updateStructParameterFields(parameter.def, parameter.value, input.fields),
);
const insertCustomNodeGraphEffectNodeParameterArrayElement = defineCommand<CustomNodeGraphEffectNodeParameterReference & { beforeElementId?: string | null }, CustomNodeGraphEffectNodeParameterReference>({
	label: 'Insert Custom Node Graph Effect node parameter array element',
	prepare(state, input) {
		const parameter = resolveNodeParam(getCustomNodeGraphEffectEffectNode(state, input.target), input.parameterPath, getEffectDefinitions(state));
		if (!isParameterType(parameter.def, 'array') || parameter.value.inputSource !== 'literal' || !Array.isArray(parameter.value.value)) throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[];
		if (parameter.def.maxElements != null && elements.length >= parameter.def.maxElements) throw new Error('Array parameter element limit reached');
		const index = input.beforeElementId == null ? elements.length : elements.findIndex(element => element.id === input.beforeElementId);
		if (index < 0) throw new Error('Array element not found');
		const element = { id: genId(), binding: createResetParameterBinding(getArrayElementDefinition(parameter.def)) };
		const after = deepClone(elements);
		after.splice(index, 0, element);
		return prepareCustomNodeGraphEffectValue(parameter.value, { inputSource: 'literal', value: after } as CustomNodeGraphEffectParameterBinding,
			(currentState, value) => resolveNodeParam(getCustomNodeGraphEffectEffectNode(currentState, input.target), input.parameterPath, getEffectDefinitions(currentState)).setValue(value),
			parameterChanges(input, 'arrayElements'), { target: input.target, parameterPath: [...input.parameterPath, element.id] });
	},
});
const removeCustomNodeGraphEffectNodeParameterArrayElements = defineNodeParameterCommand<CustomNodeGraphEffectNodeParameterReference & { elementIds: string[] }>(
	'Remove Custom Node Graph Effect node parameter array elements',
	(parameter, input) => {
		if (parameter.def.dataType.kind !== 'array' || parameter.value.inputSource !== 'literal' || !Array.isArray(parameter.value.value)) throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[];
		if (input.elementIds.some(id => !elements.some(element => element.id === id))) throw new Error('Array element not found');
		return { inputSource: 'literal', value: elements.filter(element => !input.elementIds.includes(element.id)) };
	},
	{ kind: 'arrayElements' },
);

const setCustomNodeGraphEffectNodeBypass = defineCommand<{ target: CustomNodeGraphEffectNodeReference; bypass: boolean }>({
	label: 'Set Custom Node Graph Effect node bypass',
	prepare(state, input) {
		if (typeof input.bypass !== 'boolean') throw new Error('Bypass must be a boolean');
		return prepareCustomNodeGraphEffectValue(getCustomNodeGraphEffectEffectNode(state, input.target).isBypass, input.bypass,
			(currentState, value) => { getCustomNodeGraphEffectEffectNode(currentState, input.target).isBypass = value; },
			[{ type: 'node', target: input.target.customNodeGraphEffect, nodeId: input.target.nodeId, changes: [{ type: 'bypass' }] }]);
	},
});
const setCustomNodeGraphEffectNodeDisplayName = defineCommand<{ target: CustomNodeGraphEffectNodeReference; displayName: string }>({
	label: 'Set Custom Node Graph Effect node display name',
	prepare(state, input) {
		if (typeof input.displayName !== 'string') throw new Error('Display name must be a string');
		const { customNodeGraphEffect, nodeId } = input.target;
		const getNode = (currentState: ProjectState) => {
			const node = stateUtility.findNode(currentState, { ...customNodeGraphEffect, nodeId });
			if (node?.type !== 'effect' && node?.type !== 'relay') throw new Error('Custom Node Graph Effect effect or relay node not found');
			return node;
		};
		const node = getNode(state);
		const before = node.type === 'effect' ? node.displayName : node.label ?? null;
		const after = node.type === 'relay' && input.displayName === '' ? null : input.displayName;
		return prepareCustomNodeGraphEffectValue(before, after, (currentState, displayName) => {
			const currentNode = getNode(currentState);
			if (currentNode.type === 'effect') currentNode.displayName = displayName ?? '';
			else if (displayName == null) delete currentNode.label;
			else currentNode.label = displayName;
		}, [{ type: 'nodeName', target: customNodeGraphEffect, nodeId }]);
	},
});
const setCustomNodeGraphEffectNodeStaticSetting = defineCommand<{ target: CustomNodeGraphEffectNodeReference; key: string; value: string | number | boolean | null }>({
	label: 'Set Custom Node Graph Effect node static setting',
	prepare(state, input) {
		const node = getCustomNodeGraphEffectEffectNode(state, input.target);
		const definition = getEffectDefinitions(state)[node.effectId].staticSettingDefs?.[input.key];
		if (definition == null) throw new Error('Static setting not found');
		validateStaticSettingValue(definition, input.value);
		return prepareCustomNodeGraphEffectValue(node.staticSettings, { ...node.staticSettings, [input.key]: input.value },
			(currentState, value) => { getCustomNodeGraphEffectEffectNode(currentState, input.target).staticSettings = value; },
			[{ type: 'node', target: input.target.customNodeGraphEffect, nodeId: input.target.nodeId, changes: [{ type: 'staticSetting' }] }]);
	},
});
const setCustomNodeGraphEffectNodeResolution = defineCommand<{ target: CustomNodeGraphEffectNodeReference; resolution: CustomNodeGraphEffectEffectNode['resolution'] }>({
	label: 'Set Custom Node Graph Effect node resolution',
	prepare(state, input) {
		validateEffectResolution(input.resolution);
		return prepareCustomNodeGraphEffectValue(getCustomNodeGraphEffectEffectNode(state, input.target).resolution, input.resolution,
			(currentState, value) => { getCustomNodeGraphEffectEffectNode(currentState, input.target).resolution = value; },
			[{ type: 'node', target: input.target.customNodeGraphEffect, nodeId: input.target.nodeId, changes: [{ type: 'resolution' }] }]);
	},
});
const setCustomNodeGraphEffectOutputConnection = defineCommand<{ target: CustomNodeGraphEffectOutputReference; source: { nodeId: string; outputPort: string } | null; connectionTypePolicy?: ConnectionTypePolicy }>({
	label: 'Set Custom Node Graph Effect output connection',
	prepare(state, input) {
		const policy = input.connectionTypePolicy ?? 'strict';
		if (policy !== 'strict' && policy !== 'allowMismatch') throw new Error('Invalid connection type policy');
		const customNodeGraphEffect = getCustomNodeGraphEffect(state, input.target.customNodeGraphEffect);
		const outputDefinition = customNodeGraphEffect.outputDefs.find(definition => definition.id === input.target.outputId);
		if (outputDefinition == null) throw new Error('Custom Node Graph Effect output not found');
		const getOutputNode = (currentState: ProjectState) => {
			const node = getCustomNodeGraphEffect(currentState, input.target.customNodeGraphEffect).nodes.find(candidate => candidate.type === 'globalOut');
			if (node?.type !== 'globalOut') throw new Error('Global output node not found');
			return node;
		};
		if (input.source != null) {
			const source = customNodeGraphEffect.nodes.find(candidate => candidate.id === input.source!.nodeId);
			const output = getNodeOutputs(source, customNodeGraphEffect.paramDefs, getEffectDefinitions(state))[input.source.outputPort];
			if (output == null) throw new Error('Node output not found in this Custom Node Graph Effect');
			if (!canConnectCustomNodeGraphEffectTypes(output.dataType, outputDefinition.dataType, policy)) throw new Error('Node output type does not match the Custom Node Graph Effect output');
		}
		const before = getOutputNode(state).inputs[input.target.outputId] ?? null;
		const after = input.source ?? (before?.nodeId == null ? before : { nodeId: null, outputPort: null });
		return prepareCustomNodeGraphEffectValue(before, after,
			(currentState, value) => {
				if (value == null) delete getOutputNode(currentState).inputs[input.target.outputId];
				else getOutputNode(currentState).inputs[input.target.outputId] = value;
			}, [{ type: 'customNodeGraphEffect', target: input.target.customNodeGraphEffect }]);
	},
});

function validateCustomNodeGraphEffectPublicParameterDefinition(customNodeGraphEffect: CustomNodeGraphEffect, definition: CustomNodeGraphEffectParamDef, previousId?: CustomNodeGraphEffectPublicParameterId) {
	validateParameterDefaultValues(definition);
	if (definition.dataType.kind === 'audioSource') {
		validateLiteralAudioSourceBinding(definition.defaultValue);
		if (definition.defaultValue.value !== null) throw new Error('The default audio source must be unselected');
	}
	if (isParameterType(definition, 'enum')) {
		const options = definition.dataType.options;
		if (options.length === 0 || options.some(value => value.trim() === '') || new Set(options).size !== options.length) throw new Error('Enum options must be non-empty and unique');
		if (!options.includes(definition.defaultValue.value)) throw new Error('Enum default must be one of its options');
	}
	if (definition.canNode && !isTextureDataType(definition.dataType)) throw new Error('Only node-capable parameter types can be exposed as In node outputs');
	if (customNodeGraphEffect.paramDefs.some(item => item.id !== previousId && (item.id === definition.id || item.nameForReference === definition.nameForReference))) throw new Error('Parameter ID and name must be unique');
}

function validateCustomParameterDefinition(customNodeGraphEffect: CustomNodeGraphEffect, definition: CustomNodeGraphEffectCustomParameterDefinition, previousId?: CustomNodeGraphEffectCustomParameterId) {
	validateCustomNodeGraphEffectCustomParameterDefinition(definition);
	if (customNodeGraphEffect.customParameterDefs.some(candidate => candidate.id !== previousId && (candidate.id === definition.id || candidate.nameForReference === definition.nameForReference))) throw new Error('Custom parameter ID and name must be unique');
}

function validateOutputDefinition(customNodeGraphEffect: CustomNodeGraphEffect, definition: CustomNodeGraphEffectOutputDef, previousId?: string) {
	if (!isTextureDataType(definition.dataType)) throw new Error('Custom Node Graph Effect output must have a texture data type');
	if (customNodeGraphEffect.outputDefs.some(item => item.id !== previousId && (item.id === definition.id || item.name === definition.name))) throw new Error('Output ID and name must be unique');
}

const setCustomNodeGraphEffectPrimaryInput = defineCommand<{ target: CustomNodeGraphEffectTarget; primaryInputId: CustomNodeGraphEffectPublicParameterId | null }>({
	label: 'Set Custom Node Graph Effect primary input',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target, ['primaryInputId'], customNodeGraphEffect => {
		if (input.primaryInputId !== null && !customNodeGraphEffect.paramDefs.some(definition => definition.id === input.primaryInputId && definition.canNode && definition.dataType.kind === 'color')) throw new Error('Primary input must reference a node-capable color parameter');
		customNodeGraphEffect.primaryInputId = input.primaryInputId;
	}),
});
const setCustomNodeGraphEffectPrimaryAudioInput = defineCommand<{ target: CustomNodeGraphEffectTarget; primaryAudioInputId: CustomNodeGraphEffectPublicParameterId | null }>({
	label: 'Set Custom Node Graph Effect primary audio input',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target, ['primaryAudioInputId'], customNodeGraphEffect => {
		if (input.primaryAudioInputId !== null && !customNodeGraphEffect.paramDefs.some(definition => definition.id === input.primaryAudioInputId && !definition.canNode && definition.dataType.kind === 'audioSource')) throw new Error('Primary audio input must reference an audio parameter');
		customNodeGraphEffect.primaryAudioInputId = input.primaryAudioInputId;
	}),
});
const setCustomNodeGraphEffectPrimaryOutput = defineCommand<{ target: CustomNodeGraphEffectTarget; primaryOutputId: string | null }>({
	label: 'Set Custom Node Graph Effect primary output',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target, ['primaryOutputId'], customNodeGraphEffect => {
		if (input.primaryOutputId !== null && !customNodeGraphEffect.outputDefs.some(definition => definition.id === input.primaryOutputId && definition.dataType.kind === 'color')) throw new Error('Primary output must reference a color output');
		customNodeGraphEffect.primaryOutputId = input.primaryOutputId;
	}),
});

const createCustomNodeGraphEffectPublicParameter = defineCommand<{ customNodeGraphEffect: CustomNodeGraphEffectTarget; definition: Omit<CustomNodeGraphEffectParamDef, 'id'> }, CustomNodeGraphEffectPublicParameterReference>({
	label: 'Create Custom Node Graph Effect public parameter',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.customNodeGraphEffect, ['paramDefs'], customNodeGraphEffect => {
		const definition = { ...deepClone(input.definition), id: customNodeGraphEffectPublicParameterId(genId()) } as CustomNodeGraphEffectParamDef;
		validateCustomNodeGraphEffectPublicParameterDefinition(customNodeGraphEffect, definition);
		customNodeGraphEffect.paramDefs.push(definition);
		return { customNodeGraphEffect: input.customNodeGraphEffect, parameterId: definition.id };
	}),
});
const replaceCustomNodeGraphEffectPublicParameterDefinition = defineCommand<{ target: CustomNodeGraphEffectPublicParameterReference; definition: Omit<CustomNodeGraphEffectParamDef, 'id'> }>({
	label: 'Replace Custom Node Graph Effect public parameter definition',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['paramDefs', 'primaryInputId', 'primaryAudioInputId'], customNodeGraphEffect => {
		const index = customNodeGraphEffect.paramDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Custom Node Graph Effect public parameter not found');
		const definition = { ...deepClone(input.definition), id: input.target.parameterId } as CustomNodeGraphEffectParamDef;
		validateCustomNodeGraphEffectPublicParameterDefinition(customNodeGraphEffect, definition, input.target.parameterId);
		customNodeGraphEffect.paramDefs[index] = definition;
		if (customNodeGraphEffect.primaryInputId === definition.id && (!definition.canNode || definition.dataType.kind !== 'color')) customNodeGraphEffect.primaryInputId = null;
		if (customNodeGraphEffect.primaryAudioInputId === definition.id && (definition.canNode || definition.dataType.kind !== 'audioSource')) customNodeGraphEffect.primaryAudioInputId = null;
	}),
});
const removeCustomNodeGraphEffectPublicParameter = defineCommand<{ target: CustomNodeGraphEffectPublicParameterReference }>({
	label: 'Remove Custom Node Graph Effect public parameter',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['paramDefs', 'primaryInputId', 'primaryAudioInputId'], customNodeGraphEffect => {
		const index = customNodeGraphEffect.paramDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Custom Node Graph Effect public parameter not found');
		customNodeGraphEffect.paramDefs.splice(index, 1);
		if (customNodeGraphEffect.primaryInputId === input.target.parameterId) customNodeGraphEffect.primaryInputId = null;
		if (customNodeGraphEffect.primaryAudioInputId === input.target.parameterId) customNodeGraphEffect.primaryAudioInputId = null;
		// 参照IDは保持する。未解決になったノードの参照はUndoで再び有効になる。
	}),
});
const createCustomNodeGraphEffectCustomParameter = defineCommand<{ customNodeGraphEffect: CustomNodeGraphEffectTarget; definition: Omit<CustomNodeGraphEffectCustomParameterDefinition, 'id'> }, CustomNodeGraphEffectCustomParameterReference>({
	label: 'Create Custom Node Graph Effect custom parameter',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.customNodeGraphEffect, ['customParameterDefs'], customNodeGraphEffect => {
		const definition = { ...deepClone(input.definition), id: customNodeGraphEffectCustomParameterId(genId()) } as CustomNodeGraphEffectCustomParameterDefinition;
		validateCustomParameterDefinition(customNodeGraphEffect, definition);
		customNodeGraphEffect.customParameterDefs.push(definition);
		return { customNodeGraphEffect: input.customNodeGraphEffect, parameterId: definition.id };
	}),
});
const replaceCustomNodeGraphEffectCustomParameterDefinition = defineCommand<{ target: CustomNodeGraphEffectCustomParameterReference; definition: Omit<CustomNodeGraphEffectCustomParameterDefinition, 'id'> }>({
	label: 'Replace Custom Node Graph Effect custom parameter definition',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['customParameterDefs', 'customParameterValues'], customNodeGraphEffect => {
		const index = customNodeGraphEffect.customParameterDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Custom Node Graph Effect custom parameter not found');
		const definition = { ...deepClone(input.definition), id: input.target.parameterId } as CustomNodeGraphEffectCustomParameterDefinition;
		validateCustomParameterDefinition(customNodeGraphEffect, definition, input.target.parameterId);
		if (customNodeGraphEffect.customParameterDefs[index].dataType.kind !== definition.dataType.kind) delete customNodeGraphEffect.customParameterValues[definition.id];
		validateCustomNodeGraphEffectCustomParameterBinding(definition, customNodeGraphEffect.customParameterValues[definition.id] ?? definition.defaultValue);
		customNodeGraphEffect.customParameterDefs[index] = definition;
	}),
});
const removeCustomNodeGraphEffectCustomParameter = defineCommand<{ target: CustomNodeGraphEffectCustomParameterReference }>({
	label: 'Remove Custom Node Graph Effect custom parameter',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['customParameterDefs', 'customParameterValues'], customNodeGraphEffect => {
		const index = customNodeGraphEffect.customParameterDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Custom Node Graph Effect custom parameter not found');
		customNodeGraphEffect.customParameterDefs.splice(index, 1);
		delete customNodeGraphEffect.customParameterValues[input.target.parameterId];
	}),
});

const createCustomNodeGraphEffectPublicParameterFromParameter = defineCommand<CustomNodeGraphEffectNodeParameterReference, CustomNodeGraphEffectPublicParameterReference>({
	label: 'Create and connect Custom Node Graph Effect public parameter',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['paramDefs', 'nodes'], customNodeGraphEffect => {
		const node = customNodeGraphEffect.nodes.find(candidate => candidate.id === input.target.nodeId);
		if (node?.type !== 'effect') throw new Error('Effect node not found');
		const parameter = resolveNodeParam(node, input.parameterPath, getEffectDefinitions(state));
		const named = createNamedParameterFromLiteral(parameter.def, parameter.value, customNodeGraphEffect.paramDefs);
		const definition: CustomNodeGraphEffectParamDef = { ...named, id: customNodeGraphEffectPublicParameterId(genId()), nameForReference: customNodeGraphEffectPublicParameterName(named.nameForReference) };
		validateCustomNodeGraphEffectPublicParameterDefinition(customNodeGraphEffect, definition);
		customNodeGraphEffect.paramDefs.push(definition);
		parameter.setValue({ inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: definition.id });
		return { customNodeGraphEffect: input.target.customNodeGraphEffect, parameterId: definition.id };
	}),
});
const createCustomNodeGraphEffectCustomParameterFromParameter = defineCommand<CustomNodeGraphEffectNodeParameterReference, CustomNodeGraphEffectCustomParameterReference>({
	label: 'Create and connect Custom Node Graph Effect custom parameter',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['customParameterDefs', 'nodes'], customNodeGraphEffect => {
		const node = customNodeGraphEffect.nodes.find(candidate => candidate.id === input.target.nodeId);
		if (node?.type !== 'effect') throw new Error('Effect node not found');
		const parameter = resolveNodeParam(node, input.parameterPath, getEffectDefinitions(state));
		const named = createNamedParameterFromLiteral(parameter.def, parameter.value, customNodeGraphEffect.customParameterDefs);
		const definition: CustomNodeGraphEffectCustomParameterDefinition = { ...named, id: customNodeGraphEffectCustomParameterId(genId()), nameForReference: customNodeGraphEffectCustomParameterName(named.nameForReference) };
		validateCustomParameterDefinition(customNodeGraphEffect, definition);
		customNodeGraphEffect.customParameterDefs.push(definition);
		parameter.setValue({ inputSource: 'customNodeGraphEffectCustomParameterValueReference', parameterId: definition.id });
		return { customNodeGraphEffect: input.target.customNodeGraphEffect, parameterId: definition.id };
	}),
});

function defineCustomParameterCommand<Input extends { target: CustomNodeGraphEffectCustomParameterReference }>(label: string,
	update: (definition: CustomNodeGraphEffectCustomParameterDefinition, current: CustomNodeGraphEffectValueParameterBinding, input: Input) => CustomNodeGraphEffectValueParameterBinding | null,
	autoMerge = false,
) {
	return defineCommand<Input>({
		label,
		getAutoMergeKey: input => {
			const source = 'source' in input ? input.source as CustomNodeGraphEffectCustomParameterSource : null;
			return autoMerge && (source?.inputSource === 'literal' || source?.inputSource === 'expression')
				? JSON.stringify([customNodeGraphEffectTargetKey(input.target.customNodeGraphEffect), input.target.parameterId, source.inputSource]) : null;
		},
		prepare(state, input) {
			const customNodeGraphEffect = getCustomNodeGraphEffect(state, input.target.customNodeGraphEffect);
			const definition = customNodeGraphEffect.customParameterDefs.find(candidate => candidate.id === input.target.parameterId);
			if (definition == null) throw new Error('Custom Node Graph Effect custom parameter not found');
			const before = customNodeGraphEffect.customParameterValues[input.target.parameterId] ?? null;
			const after = update(definition, deepClone(before ?? definition.defaultValue), input);
			validateCustomNodeGraphEffectCustomParameterBinding(definition, after ?? definition.defaultValue);
			return prepareCustomNodeGraphEffectValue(before, after, (currentState, value) => {
				const current = getCustomNodeGraphEffect(currentState, input.target.customNodeGraphEffect);
				if (value == null) delete current.customParameterValues[input.target.parameterId];
				else current.customParameterValues[input.target.parameterId] = value;
			}, [{ type: 'customNodeGraphEffect', target: input.target.customNodeGraphEffect, customParameterValuesOnly: true }]);
		},
	});
}

const setCustomNodeGraphEffectCustomParameterSource = defineCustomParameterCommand<{ target: CustomNodeGraphEffectCustomParameterReference; source: CustomNodeGraphEffectCustomParameterSource }>(
	'Set Custom Node Graph Effect custom parameter source', (_definition, current, input) => {
		const source = deepClone(input.source);
		if ('expressionModifier' in source) delete source.expressionModifier;
		return preserveParameterExpressionModifier(current, source);
	}, true,
);
const switchCustomNodeGraphEffectCustomParameterInputSource = defineCustomParameterCommand<{ target: CustomNodeGraphEffectCustomParameterReference; inputSource: CustomNodeGraphEffectValueParameterBinding['inputSource'] }>(
	'Switch Custom Node Graph Effect custom parameter input source', (definition, current, input) => editCustomNodeGraphEffectCustomParameterBinding(definition, current, { kind: 'inputSource', inputSource: input.inputSource }),
);
const setCustomNodeGraphEffectCustomParameterExpressionModifier = defineCustomParameterCommand<{ target: CustomNodeGraphEffectCustomParameterReference; expressionModifier: ParameterExpressionModifier | null }>(
	'Set Custom Node Graph Effect custom parameter expression modifier', (definition, current, input) => {
		if (!supportsParameterExpressionModifier(definition, current)) throw new Error('Expression modifier is not available for this parameter');
		return { ...current, expressionModifier: deepClone(input.expressionModifier) };
	},
);
const replaceCustomNodeGraphEffectCustomParameterBinding = defineCustomParameterCommand<{ target: CustomNodeGraphEffectCustomParameterReference; binding: CustomNodeGraphEffectValueParameterBinding }>(
	'Replace Custom Node Graph Effect custom parameter binding', (_definition, _current, input) => deepClone(input.binding),
);
const resetCustomNodeGraphEffectCustomParameter = defineCustomParameterCommand<{ target: CustomNodeGraphEffectCustomParameterReference }>(
	'Reset Custom Node Graph Effect custom parameter', () => null,
);

const createCustomNodeGraphEffectOutput = defineCommand<{ customNodeGraphEffect: CustomNodeGraphEffectTarget; definition: Omit<CustomNodeGraphEffectOutputDef, 'id'> }, CustomNodeGraphEffectOutputReference>({
	label: 'Create Custom Node Graph Effect output',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.customNodeGraphEffect, ['outputDefs', 'primaryOutputId'], customNodeGraphEffect => {
		const definition = { ...deepClone(input.definition), id: genId() };
		validateOutputDefinition(customNodeGraphEffect, definition);
		customNodeGraphEffect.outputDefs.push(definition);
		if (customNodeGraphEffect.primaryOutputId == null && definition.dataType.kind === 'color') customNodeGraphEffect.primaryOutputId = definition.id;
		return { customNodeGraphEffect: input.customNodeGraphEffect, outputId: definition.id };
	}),
});
const replaceCustomNodeGraphEffectOutputDefinition = defineCommand<{ target: CustomNodeGraphEffectOutputReference; definition: Omit<CustomNodeGraphEffectOutputDef, 'id'> }>({
	label: 'Replace Custom Node Graph Effect output definition',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['outputDefs', 'primaryOutputId'], customNodeGraphEffect => {
		const index = customNodeGraphEffect.outputDefs.findIndex(definition => definition.id === input.target.outputId);
		if (index < 0) throw new Error('Custom Node Graph Effect output not found');
		const definition = { ...deepClone(input.definition), id: input.target.outputId };
		validateOutputDefinition(customNodeGraphEffect, definition, input.target.outputId);
		customNodeGraphEffect.outputDefs[index] = definition;
		if (customNodeGraphEffect.primaryOutputId === definition.id && definition.dataType.kind !== 'color') customNodeGraphEffect.primaryOutputId = null;
	}),
});
const removeCustomNodeGraphEffectOutput = defineCommand<{ target: CustomNodeGraphEffectOutputReference }>({
	label: 'Remove Custom Node Graph Effect output',
	prepare: (state, input) => prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['outputDefs', 'primaryOutputId'], customNodeGraphEffect => {
		const index = customNodeGraphEffect.outputDefs.findIndex(definition => definition.id === input.target.outputId);
		if (index < 0) throw new Error('Custom Node Graph Effect output not found');
		customNodeGraphEffect.outputDefs.splice(index, 1);
		if (customNodeGraphEffect.primaryOutputId === input.target.outputId) customNodeGraphEffect.primaryOutputId = null;
		// Outの接続を残し、定義をUndoすると同じ配線が再び有効になる。
	}),
});

export const CUSTOM_NODE_GRAPH_EFFECT_PARAMETERS_COMMAND_DEFS = {
	setCustomNodeGraphEffectNodeParameterSource: withCommandContract(setCustomNodeGraphEffectNodeParameterSource, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectNodeParameterSource),
	switchCustomNodeGraphEffectNodeParameterInputSource: withCommandContract(switchCustomNodeGraphEffectNodeParameterInputSource, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.switchCustomNodeGraphEffectNodeParameterInputSource),
	setCustomNodeGraphEffectNodeParameterExpressionModifier: withCommandContract(setCustomNodeGraphEffectNodeParameterExpressionModifier, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectNodeParameterExpressionModifier),
	replaceCustomNodeGraphEffectNodeParameterBinding: withCommandContract(replaceCustomNodeGraphEffectNodeParameterBinding, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.replaceCustomNodeGraphEffectNodeParameterBinding),
	resetCustomNodeGraphEffectNodeParameter: withCommandContract(resetCustomNodeGraphEffectNodeParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.resetCustomNodeGraphEffectNodeParameter),
	setCustomNodeGraphEffectNodeParameterFields: withCommandContract(setCustomNodeGraphEffectNodeParameterFields, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectNodeParameterFields),
	insertCustomNodeGraphEffectNodeParameterArrayElement: withCommandContract(insertCustomNodeGraphEffectNodeParameterArrayElement, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.insertCustomNodeGraphEffectNodeParameterArrayElement),
	removeCustomNodeGraphEffectNodeParameterArrayElements: withCommandContract(removeCustomNodeGraphEffectNodeParameterArrayElements, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.removeCustomNodeGraphEffectNodeParameterArrayElements),
	setCustomNodeGraphEffectNodeBypass: withCommandContract(setCustomNodeGraphEffectNodeBypass, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectNodeBypass),
	setCustomNodeGraphEffectNodeDisplayName: withCommandContract(setCustomNodeGraphEffectNodeDisplayName, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectNodeDisplayName),
	setCustomNodeGraphEffectNodeStaticSetting: withCommandContract(setCustomNodeGraphEffectNodeStaticSetting, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectNodeStaticSetting),
	setCustomNodeGraphEffectNodeResolution: withCommandContract(setCustomNodeGraphEffectNodeResolution, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectNodeResolution),
	setCustomNodeGraphEffectOutputConnection: withCommandContract(setCustomNodeGraphEffectOutputConnection, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectOutputConnection),
	setCustomNodeGraphEffectPrimaryInput: withCommandContract(setCustomNodeGraphEffectPrimaryInput, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectPrimaryInput),
	setCustomNodeGraphEffectPrimaryAudioInput: withCommandContract(setCustomNodeGraphEffectPrimaryAudioInput, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectPrimaryAudioInput),
	setCustomNodeGraphEffectPrimaryOutput: withCommandContract(setCustomNodeGraphEffectPrimaryOutput, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectPrimaryOutput),
	createCustomNodeGraphEffectPublicParameter: withCommandContract(createCustomNodeGraphEffectPublicParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.createCustomNodeGraphEffectPublicParameter),
	replaceCustomNodeGraphEffectPublicParameterDefinition: withCommandContract(replaceCustomNodeGraphEffectPublicParameterDefinition, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.replaceCustomNodeGraphEffectPublicParameterDefinition),
	removeCustomNodeGraphEffectPublicParameter: withCommandContract(removeCustomNodeGraphEffectPublicParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.removeCustomNodeGraphEffectPublicParameter),
	createCustomNodeGraphEffectPublicParameterFromParameter: withCommandContract(createCustomNodeGraphEffectPublicParameterFromParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.createCustomNodeGraphEffectPublicParameterFromParameter),
	createCustomNodeGraphEffectCustomParameterFromParameter: withCommandContract(createCustomNodeGraphEffectCustomParameterFromParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.createCustomNodeGraphEffectCustomParameterFromParameter),
	createCustomNodeGraphEffectCustomParameter: withCommandContract(createCustomNodeGraphEffectCustomParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.createCustomNodeGraphEffectCustomParameter),
	replaceCustomNodeGraphEffectCustomParameterDefinition: withCommandContract(replaceCustomNodeGraphEffectCustomParameterDefinition, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.replaceCustomNodeGraphEffectCustomParameterDefinition),
	removeCustomNodeGraphEffectCustomParameter: withCommandContract(removeCustomNodeGraphEffectCustomParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.removeCustomNodeGraphEffectCustomParameter),
	setCustomNodeGraphEffectCustomParameterSource: withCommandContract(setCustomNodeGraphEffectCustomParameterSource, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectCustomParameterSource),
	switchCustomNodeGraphEffectCustomParameterInputSource: withCommandContract(switchCustomNodeGraphEffectCustomParameterInputSource, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.switchCustomNodeGraphEffectCustomParameterInputSource),
	setCustomNodeGraphEffectCustomParameterExpressionModifier: withCommandContract(setCustomNodeGraphEffectCustomParameterExpressionModifier, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.setCustomNodeGraphEffectCustomParameterExpressionModifier),
	replaceCustomNodeGraphEffectCustomParameterBinding: withCommandContract(replaceCustomNodeGraphEffectCustomParameterBinding, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.replaceCustomNodeGraphEffectCustomParameterBinding),
	resetCustomNodeGraphEffectCustomParameter: withCommandContract(resetCustomNodeGraphEffectCustomParameter, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.resetCustomNodeGraphEffectCustomParameter),
	createCustomNodeGraphEffectOutput: withCommandContract(createCustomNodeGraphEffectOutput, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.createCustomNodeGraphEffectOutput),
	replaceCustomNodeGraphEffectOutputDefinition: withCommandContract(replaceCustomNodeGraphEffectOutputDefinition, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.replaceCustomNodeGraphEffectOutputDefinition),
	removeCustomNodeGraphEffectOutput: withCommandContract(removeCustomNodeGraphEffectOutput, CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS.removeCustomNodeGraphEffectOutput),
};
