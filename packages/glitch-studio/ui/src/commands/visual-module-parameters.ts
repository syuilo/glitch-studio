import { AiSON } from '@syuilo/aiscript';
import { validateStaticSettingValue } from '@gs/shared/static-setting.ts';
import { preserveParameterExpressionModifier, supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import { getArrayElementDefinition, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { visualModuleTargetKey } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { validateVisualModuleCustomParameterDefinition, validateVisualModuleCustomParameterBinding } from '@gs/subsystems_visual-module_shared/custom-parameters.ts';
import { visualModulePublicParameterId, visualModulePublicParameterName, visualModuleCustomParameterId, visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import { updateStructParameterFields } from '../utility/struct-parameter-edit.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { getVisualModule } from '../utility/visual-module-target.ts';
import { createResetParameterBinding } from '../utility/parameter-default.ts';
import { createInlineKeyframesTimeline } from '../utility/keyframes-timeline.ts';
import { createInlineAutomationGraph } from '../utility/automation-graph.ts';
import { resolveNodeParam } from '../utility/node-params.ts';
import { createNamedParameterFromLiteral } from '../utility/named-parameter-creation.ts';
import { editVisualModuleCustomParameterBinding } from '../utility/visual-module-custom-parameter-edit.ts';
import { validateVisualModuleNodeParameterBinding } from './visual-module-parameter-validation.ts';
import { getParameterBindingChangeKind } from './parameter-change.ts';
import { defineCommand } from './definition.ts';
import { canConnectVisualModuleTypes } from './visual-module.ts';
import { getVisualModuleEffectNode, prepareVisualModuleFields, prepareVisualModuleValue } from './visual-module-change.ts';
import type { StructParameterFieldBindings } from '../utility/struct-parameter-edit.ts';
import type { ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { VisualModuleCustomParameterDefinition, VisualModuleCustomParameterId, VisualModulePublicParameterId, VisualModuleValueParameterBinding, VisualModuleParameterBinding, VisualModuleEffectNode, VisualModule, VisualModuleParamDef, VisualModuleOutputDef } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { VisualModuleNodeReference } from './visual-module-change.ts';
import type { ConnectionTypePolicy } from './visual-module.ts';
import type { ProjectState, AppStateChange } from '../Project.ts';

export type VisualModuleNodeParameterReference = { target: VisualModuleNodeReference; parameterPath: ParamPath };
export type VisualModulePublicParameterReference = { visualModule: VisualModuleTarget; parameterId: VisualModulePublicParameterId };
export type VisualModuleCustomParameterReference = { visualModule: VisualModuleTarget; parameterId: VisualModuleCustomParameterId };
export type VisualModuleOutputReference = { visualModule: VisualModuleTarget; outputId: string };
type WithoutExpressionModifier<Value> = Value extends unknown ? Omit<Value, 'expressionModifier'> : never;
export type VisualModuleParameterSource = WithoutExpressionModifier<VisualModuleParameterBinding>;
export type VisualModuleCustomParameterSource = WithoutExpressionModifier<VisualModuleValueParameterBinding>;

function parameterChanges(input: VisualModuleNodeParameterReference, kind: ParameterChangeKind): AppStateChange[] {
	return [{ type: 'node', target: input.target.visualModule, nodeId: input.target.nodeId, changes: [{ type: 'parameter', kind }] }];
}

function defineNodeParameterCommand<Input extends VisualModuleNodeParameterReference>(
	label: string,
	update: (parameter: ReturnType<typeof resolveNodeParam>, input: Input) => VisualModuleParameterBinding,
	options: { kind?: ParameterChangeKind; preserveModifier?: boolean; autoMerge?: boolean } = {},
) {
	return defineCommand<Input>({
		label,
		getAutoMergeKey: input => {
			const source = 'source' in input ? input.source as VisualModuleParameterSource : null;
			return options.autoMerge === true && (source?.inputSource === 'literal' || source?.inputSource === 'expression')
				? JSON.stringify([visualModuleTargetKey(input.target.visualModule), input.target.nodeId, input.parameterPath, source.inputSource]) : null;
		},
		prepare(state, input) {
			const parameter = resolveNodeParam(getVisualModuleEffectNode(state, input.target), input.parameterPath, getEffectDefinitions(state));
			// prepare中に更新関数へ渡す値も複製し、検証失敗でライブ状態を変更しない。
			const draftParameter = { ...parameter, value: deepClone(parameter.value) };
			const updated = update(draftParameter, input);
			const after = options.preserveModifier === true ? preserveParameterExpressionModifier(parameter.value, updated) : updated;
			const policy = 'connectionTypePolicy' in input ? input.connectionTypePolicy as ConnectionTypePolicy : 'strict';
			validateVisualModuleNodeParameterBinding(state, getVisualModule(state, input.target.visualModule), parameter.def, after, policy, parameter.value);
			return prepareVisualModuleValue(parameter.value, after, (currentState, value) => {
				resolveNodeParam(getVisualModuleEffectNode(currentState, input.target), input.parameterPath, getEffectDefinitions(currentState)).setValue(value);
			}, parameterChanges(input, options.kind ?? getParameterBindingChangeKind(parameter.def, parameter.value, after)));
		},
	});
}

function assertLeafParameter(parameter: ReturnType<typeof resolveNodeParam>) {
	if (parameter.def.dataType.kind === 'array' || parameter.def.dataType.kind === 'struct') throw new Error('Struct and array containers cannot change input source');
}

const setVisualModuleNodeParameterSource = defineNodeParameterCommand<VisualModuleNodeParameterReference & {
	source: VisualModuleParameterSource; preserveNodeSampling?: boolean; connectionTypePolicy?: ConnectionTypePolicy;
}>(
	'Set Visual Module node parameter source',
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

const switchVisualModuleNodeParameterInputSource = defineNodeParameterCommand<VisualModuleNodeParameterReference & { inputSource: VisualModuleParameterBinding['inputSource'] }>(
	'Switch Visual Module node parameter input source',
	(parameter, input) => {
		assertLeafParameter(parameter);
		switch (input.inputSource) {
			case 'literal': return deepClone(parameter.def.defaultValue);
			case 'expression': return { inputSource: 'expression', expression: AiSON.stringify(parameter.value.inputSource === 'literal' ? parameter.value.value : parameter.def.defaultValue.value) };
			case 'envVariable': return { inputSource: 'envVariable', variable: '' };
			case 'automationGraphReference': return { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' };
			case 'automationGraphInline': return createInlineAutomationGraph();
			case 'keyframesTimelineInline': return createInlineKeyframesTimeline(parameter.def, parameter.value);
			case 'visualModulePublicParameterReference': return { inputSource: input.inputSource, parameterId: visualModulePublicParameterId('') };
			case 'visualModuleCustomParameterValueReference': return { inputSource: input.inputSource, parameterId: visualModuleCustomParameterId('') };
			case 'node': return { inputSource: 'node', nodeId: null, outputPort: null };
			default: throw new Error('Unsupported Visual Module parameter input source');
		}
	},
	{ kind: 'inputSource', preserveModifier: true },
);
const setVisualModuleNodeParameterExpressionModifier = defineNodeParameterCommand<VisualModuleNodeParameterReference & { expressionModifier: ParameterExpressionModifier | null }>(
	'Set Visual Module node parameter expression modifier',
	(parameter, input) => {
		if (!supportsParameterExpressionModifier(parameter.def, parameter.value)) throw new Error('Expression modifier is not available for this parameter');
		return { ...parameter.value, expressionModifier: deepClone(input.expressionModifier) };
	},
);
const replaceVisualModuleNodeParameterBinding = defineNodeParameterCommand<VisualModuleNodeParameterReference & { binding: VisualModuleParameterBinding; connectionTypePolicy?: ConnectionTypePolicy }>(
	'Replace Visual Module node parameter binding', (_parameter, input) => deepClone(input.binding),
);
const resetVisualModuleNodeParameter = defineNodeParameterCommand<VisualModuleNodeParameterReference>(
	'Reset Visual Module node parameter', parameter => createResetParameterBinding(parameter.def), { kind: 'reset' },
);
const setVisualModuleNodeParameterFields = defineNodeParameterCommand<VisualModuleNodeParameterReference & { fields: StructParameterFieldBindings }>(
	'Set Visual Module node parameter fields', (parameter, input) => updateStructParameterFields(parameter.def, parameter.value, input.fields),
);
const insertVisualModuleNodeParameterArrayElement = defineCommand<VisualModuleNodeParameterReference & { beforeElementId?: string | null }, VisualModuleNodeParameterReference>({
	label: 'Insert Visual Module node parameter array element',
	prepare(state, input) {
		const parameter = resolveNodeParam(getVisualModuleEffectNode(state, input.target), input.parameterPath, getEffectDefinitions(state));
		if (!isParameterType(parameter.def, 'array') || parameter.value.inputSource !== 'literal' || !Array.isArray(parameter.value.value)) throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<VisualModuleParameterBinding>[];
		if (parameter.def.maxElements != null && elements.length >= parameter.def.maxElements) throw new Error('Array parameter element limit reached');
		const index = input.beforeElementId == null ? elements.length : elements.findIndex(element => element.id === input.beforeElementId);
		if (index < 0) throw new Error('Array element not found');
		const element = { id: genId(), binding: createResetParameterBinding(getArrayElementDefinition(parameter.def)) };
		const after = deepClone(elements);
		after.splice(index, 0, element);
		return prepareVisualModuleValue(parameter.value, { inputSource: 'literal', value: after } as VisualModuleParameterBinding,
			(currentState, value) => resolveNodeParam(getVisualModuleEffectNode(currentState, input.target), input.parameterPath, getEffectDefinitions(currentState)).setValue(value),
			parameterChanges(input, 'arrayElements'), { target: input.target, parameterPath: [...input.parameterPath, element.id] });
	},
});
const removeVisualModuleNodeParameterArrayElements = defineNodeParameterCommand<VisualModuleNodeParameterReference & { elementIds: string[] }>(
	'Remove Visual Module node parameter array elements',
	(parameter, input) => {
		if (parameter.def.dataType.kind !== 'array' || parameter.value.inputSource !== 'literal' || !Array.isArray(parameter.value.value)) throw new Error('Expected array parameter');
		const elements = parameter.value.value as ParameterArrayElement<VisualModuleParameterBinding>[];
		if (input.elementIds.some(id => !elements.some(element => element.id === id))) throw new Error('Array element not found');
		return { inputSource: 'literal', value: elements.filter(element => !input.elementIds.includes(element.id)) };
	},
	{ kind: 'arrayElements' },
);

const setVisualModuleNodeBypass = defineCommand<{ target: VisualModuleNodeReference; bypass: boolean }>({
	label: 'Set Visual Module node bypass',
	prepare(state, input) {
		if (typeof input.bypass !== 'boolean') throw new Error('Bypass must be a boolean');
		return prepareVisualModuleValue(getVisualModuleEffectNode(state, input.target).isBypass, input.bypass,
			(currentState, value) => { getVisualModuleEffectNode(currentState, input.target).isBypass = value; },
			[{ type: 'node', target: input.target.visualModule, nodeId: input.target.nodeId, changes: [{ type: 'bypass' }] }]);
	},
});
const setVisualModuleNodeDisplayName = defineCommand<{ target: VisualModuleNodeReference; displayName: string }>({
	label: 'Set Visual Module node display name',
	prepare(state, input) {
		if (typeof input.displayName !== 'string') throw new Error('Display name must be a string');
		return prepareVisualModuleValue(getVisualModuleEffectNode(state, input.target).displayName, input.displayName,
			(currentState, value) => { getVisualModuleEffectNode(currentState, input.target).displayName = value; },
			[{ type: 'nodeName', target: input.target.visualModule, nodeId: input.target.nodeId }]);
	},
});
const setVisualModuleNodeStaticSetting = defineCommand<{ target: VisualModuleNodeReference; key: string; value: string | number | boolean | null }>({
	label: 'Set Visual Module node static setting',
	prepare(state, input) {
		const node = getVisualModuleEffectNode(state, input.target);
		const definition = getEffectDefinitions(state)[node.effectId].staticSettingDefs?.[input.key];
		if (definition == null) throw new Error('Static setting not found');
		validateStaticSettingValue(definition, input.value);
		return prepareVisualModuleValue(node.staticSettings, { ...node.staticSettings, [input.key]: input.value },
			(currentState, value) => { getVisualModuleEffectNode(currentState, input.target).staticSettings = value; },
			[{ type: 'node', target: input.target.visualModule, nodeId: input.target.nodeId, changes: [{ type: 'staticSetting' }] }]);
	},
});
const setVisualModuleNodeResolution = defineCommand<{ target: VisualModuleNodeReference; resolution: VisualModuleEffectNode['resolution'] }>({
	label: 'Set Visual Module node resolution',
	prepare(state, input) {
		validateEffectResolution(input.resolution);
		return prepareVisualModuleValue(getVisualModuleEffectNode(state, input.target).resolution, input.resolution,
			(currentState, value) => { getVisualModuleEffectNode(currentState, input.target).resolution = value; },
			[{ type: 'node', target: input.target.visualModule, nodeId: input.target.nodeId, changes: [{ type: 'resolution' }] }]);
	},
});
const setVisualModuleOutputConnection = defineCommand<{ target: VisualModuleOutputReference; source: { nodeId: string; outputPort: string } | null; connectionTypePolicy?: ConnectionTypePolicy }>({
	label: 'Set Visual Module output connection',
	prepare(state, input) {
		const policy = input.connectionTypePolicy ?? 'strict';
		if (policy !== 'strict' && policy !== 'allowMismatch') throw new Error('Invalid connection type policy');
		const visualModule = getVisualModule(state, input.target.visualModule);
		const outputDefinition = visualModule.outputDefs.find(definition => definition.id === input.target.outputId);
		if (outputDefinition == null) throw new Error('Visual Module output not found');
		const getOutputNode = (currentState: ProjectState) => {
			const node = getVisualModule(currentState, input.target.visualModule).nodes.find(candidate => candidate.type === 'globalOut');
			if (node?.type !== 'globalOut') throw new Error('Global output node not found');
			return node;
		};
		if (input.source != null) {
			const source = visualModule.nodes.find(candidate => candidate.id === input.source!.nodeId);
			const output = getNodeOutputs(source, visualModule.paramDefs, getEffectDefinitions(state))[input.source.outputPort];
			if (output == null) throw new Error('Node output not found in this Visual Module');
			if (!canConnectVisualModuleTypes(output.dataType, outputDefinition.dataType, policy)) throw new Error('Node output type does not match the Visual Module output');
		}
		const before = getOutputNode(state).inputs[input.target.outputId] ?? null;
		const after = input.source ?? (before?.nodeId == null ? before : { nodeId: null, outputPort: null });
		return prepareVisualModuleValue(before, after,
			(currentState, value) => {
				if (value == null) delete getOutputNode(currentState).inputs[input.target.outputId];
				else getOutputNode(currentState).inputs[input.target.outputId] = value;
			}, [{ type: 'visualModule', target: input.target.visualModule }]);
	},
});

function validateVisualModulePublicParameterDefinition(visualModule: VisualModule, definition: VisualModuleParamDef, previousId?: VisualModulePublicParameterId) {
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
	if (visualModule.paramDefs.some(item => item.id !== previousId && (item.id === definition.id || item.nameForReference === definition.nameForReference))) throw new Error('Parameter ID and name must be unique');
}

function validateCustomParameterDefinition(visualModule: VisualModule, definition: VisualModuleCustomParameterDefinition, previousId?: VisualModuleCustomParameterId) {
	validateVisualModuleCustomParameterDefinition(definition);
	if (visualModule.customParameterDefs.some(candidate => candidate.id !== previousId && (candidate.id === definition.id || candidate.nameForReference === definition.nameForReference))) throw new Error('Custom parameter ID and name must be unique');
}

function validateOutputDefinition(visualModule: VisualModule, definition: VisualModuleOutputDef, previousId?: string) {
	if (!isTextureDataType(definition.dataType)) throw new Error('Visual Module output must have a texture data type');
	if (visualModule.outputDefs.some(item => item.id !== previousId && (item.id === definition.id || item.name === definition.name))) throw new Error('Output ID and name must be unique');
}

const setVisualModulePrimaryInput = defineCommand<{ target: VisualModuleTarget; primaryInputId: VisualModulePublicParameterId | null }>({
	label: 'Set Visual Module primary input',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target, ['primaryInputId'], visualModule => {
		if (input.primaryInputId !== null && !visualModule.paramDefs.some(definition => definition.id === input.primaryInputId && definition.canNode && definition.dataType.kind === 'color')) throw new Error('Primary input must reference a node-capable color parameter');
		visualModule.primaryInputId = input.primaryInputId;
	}),
});
const setVisualModulePrimaryAudioInput = defineCommand<{ target: VisualModuleTarget; primaryAudioInputId: VisualModulePublicParameterId | null }>({
	label: 'Set Visual Module primary audio input',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target, ['primaryAudioInputId'], visualModule => {
		if (input.primaryAudioInputId !== null && !visualModule.paramDefs.some(definition => definition.id === input.primaryAudioInputId && !definition.canNode && definition.dataType.kind === 'audioSource')) throw new Error('Primary audio input must reference an audio parameter');
		visualModule.primaryAudioInputId = input.primaryAudioInputId;
	}),
});
const setVisualModulePrimaryOutput = defineCommand<{ target: VisualModuleTarget; primaryOutputId: string | null }>({
	label: 'Set Visual Module primary output',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target, ['primaryOutputId'], visualModule => {
		if (input.primaryOutputId !== null && !visualModule.outputDefs.some(definition => definition.id === input.primaryOutputId && definition.dataType.kind === 'color')) throw new Error('Primary output must reference a color output');
		visualModule.primaryOutputId = input.primaryOutputId;
	}),
});

const createVisualModulePublicParameter = defineCommand<{ visualModule: VisualModuleTarget; definition: Omit<VisualModuleParamDef, 'id'> }, VisualModulePublicParameterReference>({
	label: 'Create Visual Module public parameter',
	prepare: (state, input) => prepareVisualModuleFields(state, input.visualModule, ['paramDefs'], visualModule => {
		const definition = { ...deepClone(input.definition), id: visualModulePublicParameterId(genId()) } as VisualModuleParamDef;
		validateVisualModulePublicParameterDefinition(visualModule, definition);
		visualModule.paramDefs.push(definition);
		return { visualModule: input.visualModule, parameterId: definition.id };
	}),
});
const replaceVisualModulePublicParameterDefinition = defineCommand<{ target: VisualModulePublicParameterReference; definition: Omit<VisualModuleParamDef, 'id'> }>({
	label: 'Replace Visual Module public parameter definition',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['paramDefs', 'primaryInputId', 'primaryAudioInputId'], visualModule => {
		const index = visualModule.paramDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Visual Module public parameter not found');
		const definition = { ...deepClone(input.definition), id: input.target.parameterId } as VisualModuleParamDef;
		validateVisualModulePublicParameterDefinition(visualModule, definition, input.target.parameterId);
		visualModule.paramDefs[index] = definition;
		if (visualModule.primaryInputId === definition.id && (!definition.canNode || definition.dataType.kind !== 'color')) visualModule.primaryInputId = null;
		if (visualModule.primaryAudioInputId === definition.id && (definition.canNode || definition.dataType.kind !== 'audioSource')) visualModule.primaryAudioInputId = null;
	}),
});
const removeVisualModulePublicParameter = defineCommand<{ target: VisualModulePublicParameterReference }>({
	label: 'Remove Visual Module public parameter',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['paramDefs', 'primaryInputId', 'primaryAudioInputId'], visualModule => {
		const index = visualModule.paramDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Visual Module public parameter not found');
		visualModule.paramDefs.splice(index, 1);
		if (visualModule.primaryInputId === input.target.parameterId) visualModule.primaryInputId = null;
		if (visualModule.primaryAudioInputId === input.target.parameterId) visualModule.primaryAudioInputId = null;
		// 参照IDは保持する。未解決になったノードの参照はUndoで再び有効になる。
	}),
});
const createVisualModuleCustomParameter = defineCommand<{ visualModule: VisualModuleTarget; definition: Omit<VisualModuleCustomParameterDefinition, 'id'> }, VisualModuleCustomParameterReference>({
	label: 'Create Visual Module custom parameter',
	prepare: (state, input) => prepareVisualModuleFields(state, input.visualModule, ['customParameterDefs'], visualModule => {
		const definition = { ...deepClone(input.definition), id: visualModuleCustomParameterId(genId()) } as VisualModuleCustomParameterDefinition;
		validateCustomParameterDefinition(visualModule, definition);
		visualModule.customParameterDefs.push(definition);
		return { visualModule: input.visualModule, parameterId: definition.id };
	}),
});
const replaceVisualModuleCustomParameterDefinition = defineCommand<{ target: VisualModuleCustomParameterReference; definition: Omit<VisualModuleCustomParameterDefinition, 'id'> }>({
	label: 'Replace Visual Module custom parameter definition',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['customParameterDefs', 'customParameterValues'], visualModule => {
		const index = visualModule.customParameterDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Visual Module custom parameter not found');
		const definition = { ...deepClone(input.definition), id: input.target.parameterId } as VisualModuleCustomParameterDefinition;
		validateCustomParameterDefinition(visualModule, definition, input.target.parameterId);
		if (visualModule.customParameterDefs[index].dataType.kind !== definition.dataType.kind) delete visualModule.customParameterValues[definition.id];
		validateVisualModuleCustomParameterBinding(definition, visualModule.customParameterValues[definition.id] ?? definition.defaultValue);
		visualModule.customParameterDefs[index] = definition;
	}),
});
const removeVisualModuleCustomParameter = defineCommand<{ target: VisualModuleCustomParameterReference }>({
	label: 'Remove Visual Module custom parameter',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['customParameterDefs', 'customParameterValues'], visualModule => {
		const index = visualModule.customParameterDefs.findIndex(definition => definition.id === input.target.parameterId);
		if (index < 0) throw new Error('Visual Module custom parameter not found');
		visualModule.customParameterDefs.splice(index, 1);
		delete visualModule.customParameterValues[input.target.parameterId];
	}),
});

const createVisualModulePublicParameterFromParameter = defineCommand<VisualModuleNodeParameterReference, VisualModulePublicParameterReference>({
	label: 'Create and connect Visual Module public parameter',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['paramDefs', 'nodes'], visualModule => {
		const node = visualModule.nodes.find(candidate => candidate.id === input.target.nodeId);
		if (node?.type !== 'effect') throw new Error('Effect node not found');
		const parameter = resolveNodeParam(node, input.parameterPath, getEffectDefinitions(state));
		const named = createNamedParameterFromLiteral(parameter.def, parameter.value, visualModule.paramDefs);
		const definition: VisualModuleParamDef = { ...named, id: visualModulePublicParameterId(genId()), nameForReference: visualModulePublicParameterName(named.nameForReference) };
		validateVisualModulePublicParameterDefinition(visualModule, definition);
		visualModule.paramDefs.push(definition);
		parameter.setValue({ inputSource: 'visualModulePublicParameterReference', parameterId: definition.id });
		return { visualModule: input.target.visualModule, parameterId: definition.id };
	}),
});
const createVisualModuleCustomParameterFromParameter = defineCommand<VisualModuleNodeParameterReference, VisualModuleCustomParameterReference>({
	label: 'Create and connect Visual Module custom parameter',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['customParameterDefs', 'nodes'], visualModule => {
		const node = visualModule.nodes.find(candidate => candidate.id === input.target.nodeId);
		if (node?.type !== 'effect') throw new Error('Effect node not found');
		const parameter = resolveNodeParam(node, input.parameterPath, getEffectDefinitions(state));
		const named = createNamedParameterFromLiteral(parameter.def, parameter.value, visualModule.customParameterDefs);
		const definition: VisualModuleCustomParameterDefinition = { ...named, id: visualModuleCustomParameterId(genId()), nameForReference: visualModuleCustomParameterName(named.nameForReference) };
		validateCustomParameterDefinition(visualModule, definition);
		visualModule.customParameterDefs.push(definition);
		parameter.setValue({ inputSource: 'visualModuleCustomParameterValueReference', parameterId: definition.id });
		return { visualModule: input.target.visualModule, parameterId: definition.id };
	}),
});

function defineCustomParameterCommand<Input extends { target: VisualModuleCustomParameterReference }>(label: string,
	update: (definition: VisualModuleCustomParameterDefinition, current: VisualModuleValueParameterBinding, input: Input) => VisualModuleValueParameterBinding | null,
	autoMerge = false,
) {
	return defineCommand<Input>({
		label,
		getAutoMergeKey: input => {
			const source = 'source' in input ? input.source as VisualModuleCustomParameterSource : null;
			return autoMerge && (source?.inputSource === 'literal' || source?.inputSource === 'expression')
				? JSON.stringify([visualModuleTargetKey(input.target.visualModule), input.target.parameterId, source.inputSource]) : null;
		},
		prepare(state, input) {
			const visualModule = getVisualModule(state, input.target.visualModule);
			const definition = visualModule.customParameterDefs.find(candidate => candidate.id === input.target.parameterId);
			if (definition == null) throw new Error('Visual Module custom parameter not found');
			const before = visualModule.customParameterValues[input.target.parameterId] ?? null;
			const after = update(definition, deepClone(before ?? definition.defaultValue), input);
			validateVisualModuleCustomParameterBinding(definition, after ?? definition.defaultValue);
			return prepareVisualModuleValue(before, after, (currentState, value) => {
				const current = getVisualModule(currentState, input.target.visualModule);
				if (value == null) delete current.customParameterValues[input.target.parameterId];
				else current.customParameterValues[input.target.parameterId] = value;
			}, [{ type: 'visualModule', target: input.target.visualModule, customParameterValuesOnly: true }]);
		},
	});
}

const setVisualModuleCustomParameterSource = defineCustomParameterCommand<{ target: VisualModuleCustomParameterReference; source: VisualModuleCustomParameterSource }>(
	'Set Visual Module custom parameter source', (_definition, current, input) => {
		const source = deepClone(input.source);
		if ('expressionModifier' in source) delete source.expressionModifier;
		return preserveParameterExpressionModifier(current, source);
	}, true,
);
const switchVisualModuleCustomParameterInputSource = defineCustomParameterCommand<{ target: VisualModuleCustomParameterReference; inputSource: VisualModuleValueParameterBinding['inputSource'] }>(
	'Switch Visual Module custom parameter input source', (definition, current, input) => editVisualModuleCustomParameterBinding(definition, current, { kind: 'inputSource', inputSource: input.inputSource }),
);
const setVisualModuleCustomParameterExpressionModifier = defineCustomParameterCommand<{ target: VisualModuleCustomParameterReference; expressionModifier: ParameterExpressionModifier | null }>(
	'Set Visual Module custom parameter expression modifier', (definition, current, input) => {
		if (!supportsParameterExpressionModifier(definition, current)) throw new Error('Expression modifier is not available for this parameter');
		return { ...current, expressionModifier: deepClone(input.expressionModifier) };
	},
);
const replaceVisualModuleCustomParameterBinding = defineCustomParameterCommand<{ target: VisualModuleCustomParameterReference; binding: VisualModuleValueParameterBinding }>(
	'Replace Visual Module custom parameter binding', (_definition, _current, input) => deepClone(input.binding),
);
const resetVisualModuleCustomParameter = defineCustomParameterCommand<{ target: VisualModuleCustomParameterReference }>(
	'Reset Visual Module custom parameter', () => null,
);

const createVisualModuleOutput = defineCommand<{ visualModule: VisualModuleTarget; definition: Omit<VisualModuleOutputDef, 'id'> }, VisualModuleOutputReference>({
	label: 'Create Visual Module output',
	prepare: (state, input) => prepareVisualModuleFields(state, input.visualModule, ['outputDefs', 'primaryOutputId'], visualModule => {
		const definition = { ...deepClone(input.definition), id: genId() };
		validateOutputDefinition(visualModule, definition);
		visualModule.outputDefs.push(definition);
		if (visualModule.primaryOutputId == null && definition.dataType.kind === 'color') visualModule.primaryOutputId = definition.id;
		return { visualModule: input.visualModule, outputId: definition.id };
	}),
});
const replaceVisualModuleOutputDefinition = defineCommand<{ target: VisualModuleOutputReference; definition: Omit<VisualModuleOutputDef, 'id'> }>({
	label: 'Replace Visual Module output definition',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['outputDefs', 'primaryOutputId'], visualModule => {
		const index = visualModule.outputDefs.findIndex(definition => definition.id === input.target.outputId);
		if (index < 0) throw new Error('Visual Module output not found');
		const definition = { ...deepClone(input.definition), id: input.target.outputId };
		validateOutputDefinition(visualModule, definition, input.target.outputId);
		visualModule.outputDefs[index] = definition;
		if (visualModule.primaryOutputId === definition.id && definition.dataType.kind !== 'color') visualModule.primaryOutputId = null;
	}),
});
const removeVisualModuleOutput = defineCommand<{ target: VisualModuleOutputReference }>({
	label: 'Remove Visual Module output',
	prepare: (state, input) => prepareVisualModuleFields(state, input.target.visualModule, ['outputDefs', 'primaryOutputId'], visualModule => {
		const index = visualModule.outputDefs.findIndex(definition => definition.id === input.target.outputId);
		if (index < 0) throw new Error('Visual Module output not found');
		visualModule.outputDefs.splice(index, 1);
		if (visualModule.primaryOutputId === input.target.outputId) visualModule.primaryOutputId = null;
		// Outの接続を残し、定義をUndoすると同じ配線が再び有効になる。
	}),
});

export const VISUAL_MODULE_PARAMETERS_COMMAND_DEFS = {
	setVisualModuleNodeParameterSource, switchVisualModuleNodeParameterInputSource,
	setVisualModuleNodeParameterExpressionModifier, replaceVisualModuleNodeParameterBinding,
	resetVisualModuleNodeParameter, setVisualModuleNodeParameterFields,
	insertVisualModuleNodeParameterArrayElement, removeVisualModuleNodeParameterArrayElements,
	setVisualModuleNodeBypass, setVisualModuleNodeDisplayName, setVisualModuleNodeStaticSetting, setVisualModuleNodeResolution,
	setVisualModuleOutputConnection,
	setVisualModulePrimaryInput, setVisualModulePrimaryAudioInput, setVisualModulePrimaryOutput,
	createVisualModulePublicParameter, replaceVisualModulePublicParameterDefinition, removeVisualModulePublicParameter,
	createVisualModulePublicParameterFromParameter, createVisualModuleCustomParameterFromParameter,
	createVisualModuleCustomParameter, replaceVisualModuleCustomParameterDefinition, removeVisualModuleCustomParameter,
	setVisualModuleCustomParameterSource, switchVisualModuleCustomParameterInputSource,
	setVisualModuleCustomParameterExpressionModifier, replaceVisualModuleCustomParameterBinding, resetVisualModuleCustomParameter,
	createVisualModuleOutput, replaceVisualModuleOutputDefinition, removeVisualModuleOutput,
};
