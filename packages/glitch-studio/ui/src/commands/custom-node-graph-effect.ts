import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { effectSourceSchema } from './effect-source-schema.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { getNodeOutputs } from '@/utility/custom-node-graph-effect-node-outputs.ts';
import { canConnectNodeDataTypes, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { z } from 'zod';
import { createEffectNodeCycleCheck, getEffectDefinitions } from '../utility/project-effects.ts';
import { createProjectCustomNodeGraphEffect } from '../utility/project-custom-node-graph-effect.ts';
import { getCustomNodeGraphEffect } from '../utility/custom-node-graph-effect-target.ts';
import { resolveNodeParam, walkNodeParams } from '../utility/node-params.ts';
import { validateCustomNodeGraphEffectNodeParameterBinding } from './custom-node-graph-effect-parameter-validation.ts';
import { defineCommand, definePublicCommand } from './definition.ts';
import { connectionTypePolicySchema, staticSettingValuesSchema, textureDataTypeSchema } from './parameter-contract-schemas.ts';
import { registeredCustomNodeGraphEffectTargetSchema, customNodeGraphEffectNodeOutputReferenceSchema, customNodeGraphEffectNodeReferenceSchema, customNodeGraphEffectParameterBindingSchema, customNodeGraphEffectTargetSchema } from './custom-node-graph-effect-contract-schemas.ts';
import { prepareCustomNodeGraphEffectFields, prepareCustomNodeGraphEffectValue } from './custom-node-graph-effect-change.ts';
import type { CustomNodeGraphEffectEffectNode, CustomNodeGraphEffectNode, CustomNodeGraphEffectRelayNode, NodeOutputReference } from '@/types/custom-node-graph-effect-view.ts';
import type { CustomNodeGraphEffectNodeReference } from './custom-node-graph-effect-change.ts';
import type { ProjectState } from '../Project.ts';
import type { CustomNodeGraphEffectImport } from '../custom-node-graph-effect-file-codec.ts';
import type { NodeParamTarget as EffectNodeParameterTarget } from '../utility/node-params.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';

export type { CustomNodeGraphEffectNodeReference } from './custom-node-graph-effect-change.ts';
export type NodeTarget = CustomNodeGraphEffectTarget & { nodeId: string };
export type NodeParamTarget = EffectNodeParameterTarget & CustomNodeGraphEffectTarget;

// 所在の解決だけを共有する。環境設定やUIの選択はここでは参照しない。
export const stateUtility = {
	getCustomNodeGraphEffect,
	findNode: (state: ProjectState, target: NodeTarget): CustomNodeGraphEffectNode | null =>
		getCustomNodeGraphEffect(state, target).nodes.find(node => node.id === target.nodeId) ?? null,
};

const createCustomNodeGraphEffect = definePublicCommand({
	label: 'Create Custom Node Graph Effect',
	description: 'Create a registered Custom Node Graph Effect with its default In/Out nodes and color output. An omitted or null name uses the next default name. Returns a target for subsequent Commands and Queries.',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({ name: "Generated" })\n<: Query:getCustomNodeGraphEffect(customNodeGraphEffect)'],
	inputSchema: z.object({ name: z.string().nullish() }),
	resultSchema: registeredCustomNodeGraphEffectTargetSchema,
	prepare(state, input) {
		if (input.name != null && typeof input.name !== 'string') throw new Error('Custom Node Graph Effect name must be a string');
		const customNodeGraphEffect = createProjectCustomNodeGraphEffect(state.customNodeGraphEffects.value.length);
		if (input.name != null) customNodeGraphEffect.name = input.name;
		const target = { customNodeGraphEffectId: customNodeGraphEffect.id };
		return {
			result: target,
			change: {
				apply(current) { current.customNodeGraphEffects.value.push(deepClone(customNodeGraphEffect)); },
				revert(current) { current.customNodeGraphEffects.value = current.customNodeGraphEffects.value.filter(candidate => candidate.id !== customNodeGraphEffect.id); },
				changes: [{ type: 'customNodeGraphEffectRegistration', customNodeGraphEffectId: customNodeGraphEffect.id }],
			},
		};
	},
});

// 取り込みでは読み取り済みの素材を含むため、通常の生成とは異なる内部入力を受け取る。
const importCustomNodeGraphEffect = defineCommand<CustomNodeGraphEffectImport, { customNodeGraphEffectId: string }>({
	label: 'Import Custom Node Graph Effect',
	prepare(state, input) {
		const imported = deepClone(input);
		if (state.customNodeGraphEffects.value.some(customNodeGraphEffect => customNodeGraphEffect.id === imported.customNodeGraphEffect.id)) throw new Error('Custom Node Graph Effect ID already exists');
		for (const [existing, added] of [[state.assets.value, imported.assets], [state.customShaderEffects.value, imported.customShaderEffects], [state.customNodeGraphEffects.value, [...imported.customNodeGraphEffects, imported.customNodeGraphEffect]]]) {
			const ids = new Set(existing.map(resource => resource.id));
			for (const resource of added) {
				if (ids.has(resource.id)) throw new Error('Resource ID already exists');
				ids.add(resource.id);
			}
		}
		const graphs = [...imported.customNodeGraphEffects, imported.customNodeGraphEffect];
		const graphIds = new Set(graphs.map(entry => entry.id));
		const shaderIds = new Set(imported.customShaderEffects.map(entry => entry.id));
		const assetIds = new Set(imported.assets.map(asset => asset.id));
		return {
			result: { customNodeGraphEffectId: imported.customNodeGraphEffect.id },
			change: {
				apply(current) {
					current.assets.value.push(...deepClone(imported.assets));
					current.customNodeGraphEffects.value.push(...deepClone(graphs));
					current.customShaderEffects.value.push(...deepClone(imported.customShaderEffects));
				},
				revert(current) {
					current.customNodeGraphEffects.value = current.customNodeGraphEffects.value.filter(customNodeGraphEffect => !graphIds.has(customNodeGraphEffect.id));
					current.customShaderEffects.value = current.customShaderEffects.value.filter(entry => !shaderIds.has(entry.id));
					current.assets.value = current.assets.value.filter(asset => !assetIds.has(asset.id));
				},
				changes: [
					...graphs.map(entry => ({ type: 'customNodeGraphEffectRegistration' as const, customNodeGraphEffectId: entry.id })),
					...imported.customShaderEffects.map(entry => ({ type: 'customShaderEffect' as const, customShaderEffectId: entry.id })),
					...imported.assets.map(asset => ({ type: 'asset' as const, assetId: asset.id })),
				],
			},
		};
	},
});

const setCustomNodeGraphEffectName = definePublicCommand({
	label: 'Set Custom Node Graph Effect name',
	description: 'Rename a registered Custom Node Graph Effect. To rename an inline Custom Node Graph Effect, rename its owning Timeline layer instead.',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nCommand:setCustomNodeGraphEffectName({ target: customNodeGraphEffect, name: "Background" })'],
	inputSchema: z.object({ target: registeredCustomNodeGraphEffectTargetSchema, name: z.string() }),
	resultSchema: z.null(),
	prepare(state, input) {
		if (typeof input.name !== 'string') throw new Error('Custom Node Graph Effect name must be a string');
		const getRegistered = (current: ProjectState) => {
			const customNodeGraphEffect = current.customNodeGraphEffects.value.find(candidate => candidate.id === input.target.customNodeGraphEffectId);
			if (customNodeGraphEffect == null) throw new Error('Custom Node Graph Effect not found');
			return customNodeGraphEffect;
		};
		return prepareCustomNodeGraphEffectValue(getRegistered(state).name, input.name,
			(current, name) => { getRegistered(current).name = name; },
			[{ type: 'customNodeGraphEffectName', customNodeGraphEffectId: input.target.customNodeGraphEffectId }]);
	},
});

const createCustomNodeGraphEffectEffectNode = definePublicCommand({
	label: 'Create an effect node in a Custom Node Graph Effect',
	description: 'Create an Effect node using an effectSource and its defaults. A nested Custom Node Graph Effect cannot reference the containing graph directly or indirectly. parameters supplies complete bindings by parameter name. staticSettings contains plain static values. appendToPrimaryOutput connects compatible primary ports to the existing chain. Omitted connectionMode is none. connectionTypePolicy defaults to strict.',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet node = Command:createCustomNodeGraphEffectEffectNode({ customNodeGraphEffect: customNodeGraphEffect, effectSource: { type: "nativeEffect", id: "fill" }, connectionMode: "appendToPrimaryOutput" })\n<: Query:getNode(node)'],
	inputSchema: z.object({
		customNodeGraphEffect: customNodeGraphEffectTargetSchema, effectSource: effectSourceSchema, staticSettings: staticSettingValuesSchema.optional(),
		parameters: z.record(z.string(), customNodeGraphEffectParameterBindingSchema).nullish(),
		connectionMode: z.enum(['none', 'appendToPrimaryOutput']).nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish(),
	}),
	resultSchema: customNodeGraphEffectNodeReferenceSchema,
	prepare(state, input) {
		const definitions = getEffectDefinitions(state);
		const definition = definitions.describe(input.effectSource);
		if ('customNodeGraphEffectId' in input.customNodeGraphEffect && (input.effectSource.type === 'customNodeGraphEffectReference' || input.effectSource.type === 'inlineCustomNodeGraphEffect')) {
			const wouldCreateCycle = createEffectNodeCycleCheck(state.customNodeGraphEffects.value, input.customNodeGraphEffect.customNodeGraphEffectId);
			if (wouldCreateCycle(input.effectSource)) throw new Error('Cyclic Custom Node Graph Effect reference');
		}
		if (input.connectionMode != null && !['none', 'appendToPrimaryOutput'].includes(input.connectionMode)) throw new Error('Invalid connection mode');

		const connectionTypePolicy = input.connectionTypePolicy ?? 'strict';
		const target = { customNodeGraphEffect: deepClone(input.customNodeGraphEffect), nodeId: genId() };
		return prepareCustomNodeGraphEffectFields(state, input.customNodeGraphEffect, ['nodes'], customNodeGraphEffect => {
			const globalOut = input.connectionMode === 'appendToPrimaryOutput' ? customNodeGraphEffect.nodes.find(node => node.type === 'globalOut') : null;
			const primaryOutput = customNodeGraphEffect.outputDefs.find(output => output.id === customNodeGraphEffect.primaryOutputId);
			const previousInput = primaryOutput == null ? null : globalOut?.inputs[primaryOutput.id];
			const previous = previousInput?.nodeId == null ? null : customNodeGraphEffect.nodes.find(node => node.id === previousInput.nodeId);
			const parameters: CustomNodeGraphEffectEffectNode['params'] = {};
			for (const [key, parameterDefinition] of Object.entries(definition.paramDefs)) {
				parameters[key] = createDefaultParameterBinding(parameterDefinition);
				if (key !== definition.primaryInputParameter || previousInput?.nodeId == null) continue;
				const output = getNodeOutputs(previous, customNodeGraphEffect.paramDefs, definitions)[previousInput.outputPort];
				if (canConnectNodeDataTypes(output?.dataType, getNodeInputDataType(parameterDefinition), connectionTypePolicy)) {
					parameters[key] = { inputSource: 'node', ...deepClone(previousInput), fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
				}
			}
			for (const key of Object.keys(input.parameters ?? {})) {
				if (!Object.hasOwn(definition.paramDefs, key)) throw new Error('Unknown effect parameter: ' + key);
			}
			const addedNode: CustomNodeGraphEffectEffectNode = {
				id: target.nodeId, type: 'effect', effectSource: input.effectSource, displayName: '', isBypass: false,
				resolution: { mode: 'auto', scale: 1 },
				staticSettings: createStaticSettingValues(definition.staticSettingDefs ?? {}, input.staticSettings),
				params: { ...parameters, ...deepClone(input.parameters ?? {}) }, pos: { x: 0, y: 0 },
			};
			for (const [key, parameterDefinition] of Object.entries(definition.paramDefs)) {
				validateCustomNodeGraphEffectNodeParameterBinding(state, customNodeGraphEffect, parameterDefinition, addedNode.params[key], null, connectionTypePolicy);
			}
			const outputIndex = customNodeGraphEffect.nodes.findIndex(node => node.type === 'globalOut');
			customNodeGraphEffect.nodes.splice(outputIndex < 0 ? customNodeGraphEffect.nodes.length : outputIndex, 0, addedNode);
			const primaryPort = definition.primaryOutput;
			if (globalOut != null && primaryOutput != null && primaryPort != null
				&& canConnectNodeDataTypes(definition.outputDefs[primaryPort]?.dataType, primaryOutput.dataType, connectionTypePolicy)) {
				globalOut.inputs[primaryOutput.id] = { nodeId: target.nodeId, outputPort: primaryPort };
			}
			return target;
		});
	},
});

const createCustomNodeGraphEffectRelayNode = definePublicCommand({
	label: 'Create Custom Node Graph Effect relay node',
	description: 'Create a disconnected relay node with data type any, before the Custom Node Graph Effect Out node. Returns a node target for setCustomNodeGraphEffectRelayInput and Query:getNode. The relay output port is "output".',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet relay = Command:createCustomNodeGraphEffectRelayNode({ customNodeGraphEffect: customNodeGraphEffect })\n<: Query:getNode(relay)'],
	inputSchema: z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema }),
	resultSchema: customNodeGraphEffectNodeReferenceSchema,
	prepare(state, input) {
		const target = { customNodeGraphEffect: deepClone(input.customNodeGraphEffect), nodeId: genId() };
		return prepareCustomNodeGraphEffectFields(state, target.customNodeGraphEffect, ['nodes'], customNodeGraphEffect => {
			// 作成時は未接続なので、後から任意のテクスチャ型を中継できる宣言型で追加する。
			const node: CustomNodeGraphEffectRelayNode = { id: target.nodeId, type: 'relay', dataType: { kind: 'any' }, input: { nodeId: null, outputPort: null } };
			const outputIndex = customNodeGraphEffect.nodes.findIndex(candidate => candidate.type === 'globalOut');
			customNodeGraphEffect.nodes.splice(outputIndex < 0 ? customNodeGraphEffect.nodes.length : outputIndex, 0, node);
			return target;
		});
	},
});

const setCustomNodeGraphEffectRelayInput = definePublicCommand({
	label: 'Set Custom Node Graph Effect relay input',
	description: 'Connect a relay node to an output port of another node in the same Custom Node Graph Effect. Pass source: null to disconnect. The relay passes the source through unchanged. connectionTypePolicy defaults to strict.',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet source = Command:createCustomNodeGraphEffectEffectNode({ customNodeGraphEffect: customNodeGraphEffect, effectSource: { type: "nativeEffect", id: "fill" } })\nlet relay = Command:createCustomNodeGraphEffectRelayNode({ customNodeGraphEffect: customNodeGraphEffect })\nCommand:setCustomNodeGraphEffectRelayInput({ target: relay, source: { nodeId: source.nodeId, outputPort: "output" } })'],
	inputSchema: z.object({
		target: customNodeGraphEffectNodeReferenceSchema,
		source: customNodeGraphEffectNodeOutputReferenceSchema.nullable(),
		connectionTypePolicy: connectionTypePolicySchema.nullish(),
	}),
	resultSchema: z.null(),
	prepare(state, input) {
		const relayNode = getCustomNodeGraphEffectRelayNode(state, input.target);
		const source = input.source;
		if (source != null) {
			if (source.nodeId === relayNode.id) throw new Error('Relay node cannot connect to itself');
			const customNodeGraphEffect = getCustomNodeGraphEffect(state, input.target.customNodeGraphEffect);
			const sourceNode = customNodeGraphEffect.nodes.find(candidate => candidate.id === source.nodeId);
			const output = getNodeOutputs(sourceNode, customNodeGraphEffect.paramDefs, getEffectDefinitions(state))[source.outputPort];
			if (output == null) throw new Error('Node output not found in this Custom Node Graph Effect');
			if (!canConnectNodeDataTypes(output.dataType, relayNode.dataType, input.connectionTypePolicy ?? 'strict')) throw new Error('Node output type does not match the relay input');
		}
		// 出力元だけを保存し、サンプリングはRelayを参照する側の接続に任せる。
		const after: CustomNodeGraphEffectRelayNode['input'] = source == null
			? { nodeId: null, outputPort: null }
			: { nodeId: source.nodeId, outputPort: source.outputPort };
		return prepareCustomNodeGraphEffectValue(relayNode.input, after,
			(currentState, value) => { getCustomNodeGraphEffectRelayNode(currentState, input.target).input = value; },
			[{ type: 'customNodeGraphEffect', target: input.target.customNodeGraphEffect }]);
	},
});

const setCustomNodeGraphEffectRelayDataType = definePublicCommand({
	label: 'Set Custom Node Graph Effect relay data type',
	description: 'Set the declared input and output data type of a relay node. Retains existing connections and passes through the original data without conversion.',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet relay = Command:createCustomNodeGraphEffectRelayNode({ customNodeGraphEffect: customNodeGraphEffect })\nCommand:setCustomNodeGraphEffectRelayDataType({ target: relay, dataType: { kind: "scalar" } })'],
	inputSchema: z.object({ target: customNodeGraphEffectNodeReferenceSchema, dataType: textureDataTypeSchema }),
	resultSchema: z.null(),
	prepare(state, { target, dataType }) {
		const relayNode = getCustomNodeGraphEffectRelayNode(state, target);
		return prepareCustomNodeGraphEffectValue(relayNode.dataType, { kind: dataType.kind },
			(currentState, value) => { getCustomNodeGraphEffectRelayNode(currentState, target).dataType = value; },
			[{ type: 'customNodeGraphEffect', target: target.customNodeGraphEffect }]);
	},
});

function getCustomNodeGraphEffectRelayNode(state: ProjectState, target: CustomNodeGraphEffectNodeReference): CustomNodeGraphEffectRelayNode {
	const node = stateUtility.findNode(state, { ...target.customNodeGraphEffect, nodeId: target.nodeId });
	if (node?.type !== 'relay') throw new Error('Custom Node Graph Effect relay node not found');
	return node;
}

const moveCustomNodeGraphEffectNode = definePublicCommand({
	label: 'Move Custom Node Graph Effect node',
	description: 'Move a node to an absolute zero-based index in the Custom Node Graph Effect node array. The In/Out nodes cannot move, and their reserved end positions cannot be occupied. This changes order, not canvas coordinates.',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet node = Command:createCustomNodeGraphEffectEffectNode({ customNodeGraphEffect: customNodeGraphEffect, effectSource: { type: "nativeEffect", id: "fill" } })\nCommand:moveCustomNodeGraphEffectNode({ target: node, index: 1 })'],
	inputSchema: z.object({ target: customNodeGraphEffectNodeReferenceSchema, index: z.number().int() }),
	resultSchema: z.null(),
	prepare(state, input) {
		return prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['nodes'], customNodeGraphEffect => {
			const nodes = customNodeGraphEffect.nodes;
			const source = nodes.findIndex(node => node.id === input.target.nodeId);
			if (source < 0) throw new Error('Node not found');
			if (nodes[source].type === 'globalIn' || nodes[source].type === 'globalOut') throw new Error('In/Out nodes cannot be moved');
			const minimum = nodes[0]?.type === 'globalIn' ? 1 : 0;
			const maximum = nodes.at(-1)?.type === 'globalOut' ? nodes.length - 2 : nodes.length - 1;
			if (!Number.isInteger(input.index) || input.index < minimum || input.index > maximum) throw new Error('Invalid node index');
			const [node] = nodes.splice(source, 1);
			nodes.splice(input.index, 0, node);
		});
	},
});

const removeCustomNodeGraphEffectNode = definePublicCommand({
	label: 'Remove Custom Node Graph Effect node',
	description: 'Remove an effect or relay node. In/Out nodes cannot be removed. reconnection defaults to disconnect; primaryInput reconnects consumers to the removed node\'s compatible primary input when possible. connectionTypePolicy defaults to strict. Existing expressions are not rewritten.',
	examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet node = Command:createCustomNodeGraphEffectEffectNode({ customNodeGraphEffect: customNodeGraphEffect, effectSource: { type: "nativeEffect", id: "fill" } })\nCommand:removeCustomNodeGraphEffectNode({ target: node, reconnection: "disconnect" })'],
	inputSchema: z.object({ target: customNodeGraphEffectNodeReferenceSchema, reconnection: z.enum(['disconnect', 'primaryInput']).nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish() }),
	resultSchema: z.null(),
	prepare(state, input) {
		if (input.reconnection != null && !['disconnect', 'primaryInput'].includes(input.reconnection)) throw new Error('Invalid reconnection mode');
		const connectionTypePolicy = input.connectionTypePolicy ?? 'strict';
		const definitions = getEffectDefinitions(state);
		return prepareCustomNodeGraphEffectFields(state, input.target.customNodeGraphEffect, ['nodes'], customNodeGraphEffect => {
			const removedNode = customNodeGraphEffect.nodes.find(node => node.id === input.target.nodeId);
			if (removedNode == null) throw new Error('Node not found');
			if (removedNode.type === 'globalIn' || removedNode.type === 'globalOut') throw new Error('In/Out nodes cannot be removed');
			const primary = removedNode.type === 'effect' ? definitions.describe(removedNode.effectSource)?.primaryInputParameter : null;
			const binding = removedNode.type === 'relay' ? { inputSource: 'node' as const, ...removedNode.input } : primary == null ? null : removedNode.params[primary];
			const replacement: Pick<NodeOutputReference, 'nodeId' | 'outputPort'> | null = input.reconnection === 'primaryInput'
				&& binding?.inputSource === 'node' && binding.nodeId != null && binding.nodeId !== input.target.nodeId
				? { nodeId: binding.nodeId, outputPort: binding.outputPort } : null;
			const replacementOutput = replacement == null ? null : getNodeOutputs(customNodeGraphEffect.nodes.find(node => node.id === replacement.nodeId), customNodeGraphEffect.paramDefs, definitions)[replacement.outputPort];
			for (const node of customNodeGraphEffect.nodes) {
				if (node.id === input.target.nodeId) continue;
				if (node.type === 'globalOut') {
					for (const [id, connection] of Object.entries(node.inputs)) {
						if (connection.nodeId !== input.target.nodeId) continue;
						const definition = customNodeGraphEffect.outputDefs.find(output => output.id === id);
						node.inputs[id] = replacement != null && canConnectNodeDataTypes(replacementOutput?.dataType, definition?.dataType, connectionTypePolicy)
							? deepClone(replacement) : { nodeId: null, outputPort: null };
					}
				} else if (node.type === 'relay') {
					if (node.input.nodeId === input.target.nodeId) {
						node.input = replacement != null && canConnectNodeDataTypes(replacementOutput?.dataType, node.dataType, connectionTypePolicy)
							? deepClone(replacement) : { nodeId: null, outputPort: null };
					}
				} else if (node.type === 'effect') {
					for (const { path, def, value } of walkNodeParams(node, definitions)) {
						if (!def.canNode || value.inputSource !== 'node' || value.nodeId !== input.target.nodeId) continue;
						const compatible = replacement != null && canConnectNodeDataTypes(replacementOutput?.dataType, getNodeInputDataType(def), connectionTypePolicy);
						resolveNodeParam(node, path, definitions).setValue(compatible
							? { ...deepClone(value), ...deepClone(replacement) }
							: { inputSource: 'node', nodeId: null, outputPort: null });
					}
				}
			}
			customNodeGraphEffect.nodes = customNodeGraphEffect.nodes.filter(node => node.id !== input.target.nodeId);
		});
	},
});

export const CUSTOM_NODE_GRAPH_EFFECT_COMMAND_DEFS = {
	createCustomNodeGraphEffect, importCustomNodeGraphEffect, setCustomNodeGraphEffectName,
	createCustomNodeGraphEffectEffectNode, createCustomNodeGraphEffectRelayNode, setCustomNodeGraphEffectRelayInput, setCustomNodeGraphEffectRelayDataType, moveCustomNodeGraphEffectNode, removeCustomNodeGraphEffectNode,
};
