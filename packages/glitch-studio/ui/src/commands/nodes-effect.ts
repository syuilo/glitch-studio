import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { effectSourceSchema } from './effect-source-schema.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { getNodeOutputs } from '@/utility/nodes-effect-node-outputs.ts';
import { canConnectNodeDataTypes, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { z } from 'zod';
import { createEffectNodeCycleCheck, getEffectDefinitions } from '../utility/project-effects.ts';
import { createProjectNodesEffect } from '../utility/project-nodes-effect.ts';
import { getNodesEffect } from '../utility/nodes-effect-target.ts';
import { resolveNodeParam, walkNodeParams } from '../utility/node-params.ts';
import { validateNodesEffectNodeParameterBinding } from './nodes-effect-parameter-validation.ts';
import { defineCommand, definePublicCommand } from './definition.ts';
import { connectionTypePolicySchema, staticSettingValuesSchema, textureDataTypeSchema } from './parameter-contract-schemas.ts';
import { registeredNodesEffectTargetSchema, nodesEffectNodeOutputReferenceSchema, nodesEffectNodeReferenceSchema, nodesEffectParameterBindingSchema, nodesEffectTargetSchema } from './nodes-effect-contract-schemas.ts';
import { prepareNodesEffectFields, prepareNodesEffectValue } from './nodes-effect-change.ts';
import type { NodesEffectEffectNode, NodesEffectNode, NodesEffectRelayNode, NodeOutputReference } from '@/types/nodes-effect-view.ts';
import type { NodesEffectNodeReference } from './nodes-effect-change.ts';
import type { ProjectState } from '../Project.ts';
import type { NodesEffectImport } from '../nodes-effect-file-codec.ts';
import type { NodeParamTarget as EffectNodeParameterTarget } from '../utility/node-params.ts';
import type { NodesEffectTarget } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';

export type { NodesEffectNodeReference } from './nodes-effect-change.ts';
export type NodeTarget = NodesEffectTarget & { nodeId: string };
export type NodeParamTarget = EffectNodeParameterTarget & NodesEffectTarget;

// 所在の解決だけを共有する。環境設定やUIの選択はここでは参照しない。
export const stateUtility = {
	getNodesEffect,
	findNode: (state: ProjectState, target: NodeTarget): NodesEffectNode | null =>
		getNodesEffect(state, target).nodes.find(node => node.id === target.nodeId) ?? null,
};

const createNodesEffect = definePublicCommand({
	label: 'Create Nodes Effect',
	description: 'Create a registered Nodes Effect with its default In/Out nodes and color output. An omitted or null name uses the next default name. Returns a target for subsequent Commands and Queries.',
	examples: ['let nodesEffect = Command:createNodesEffect({ name: "Generated" })\n<: Query:getNodesEffect(nodesEffect)'],
	inputSchema: z.object({ name: z.string().nullish() }),
	resultSchema: registeredNodesEffectTargetSchema,
	prepare(state, input) {
		if (input.name != null && typeof input.name !== 'string') throw new Error('Nodes Effect name must be a string');
		const nodesEffect = createProjectNodesEffect(state.nodesEffects.value.length);
		if (input.name != null) nodesEffect.name = input.name;
		const target = { nodesEffectId: nodesEffect.id };
		return {
			result: target,
			change: {
				apply(current) { current.nodesEffects.value.push(deepClone(nodesEffect)); },
				revert(current) { current.nodesEffects.value = current.nodesEffects.value.filter(candidate => candidate.id !== nodesEffect.id); },
				changes: [{ type: 'nodesEffectRegistration', nodesEffectId: nodesEffect.id }],
			},
		};
	},
});

// 取り込みでは読み取り済みの素材を含むため、通常の生成とは異なる内部入力を受け取る。
const importNodesEffect = defineCommand<NodesEffectImport, { nodesEffectId: string }>({
	label: 'Import Nodes Effect',
	prepare(state, input) {
		const imported = deepClone(input);
		if (state.nodesEffects.value.some(nodesEffect => nodesEffect.id === imported.nodesEffect.id)) throw new Error('Nodes Effect ID already exists');
		for (const [existing, added] of [[state.assets.value, imported.assets], [state.customShaderEffects.value, imported.customShaderEffects], [state.nodesEffects.value, [...imported.nodesEffects, imported.nodesEffect]]]) {
			const ids = new Set(existing.map(resource => resource.id));
			for (const resource of added) {
				if (ids.has(resource.id)) throw new Error('Resource ID already exists');
				ids.add(resource.id);
			}
		}
		const importedNodesEffects = [...imported.nodesEffects, imported.nodesEffect];
		const importedNodesEffectIds = new Set(importedNodesEffects.map(entry => entry.id));
		const shaderIds = new Set(imported.customShaderEffects.map(entry => entry.id));
		const assetIds = new Set(imported.assets.map(asset => asset.id));
		return {
			result: { nodesEffectId: imported.nodesEffect.id },
			change: {
				apply(current) {
					current.assets.value.push(...deepClone(imported.assets));
					current.nodesEffects.value.push(...deepClone(importedNodesEffects));
					current.customShaderEffects.value.push(...deepClone(imported.customShaderEffects));
				},
				revert(current) {
					current.nodesEffects.value = current.nodesEffects.value.filter(nodesEffect => !importedNodesEffectIds.has(nodesEffect.id));
					current.customShaderEffects.value = current.customShaderEffects.value.filter(entry => !shaderIds.has(entry.id));
					current.assets.value = current.assets.value.filter(asset => !assetIds.has(asset.id));
				},
				changes: [
					...importedNodesEffects.map(entry => ({ type: 'nodesEffectRegistration' as const, nodesEffectId: entry.id })),
					...imported.customShaderEffects.map(entry => ({ type: 'customShaderEffect' as const, customShaderEffectId: entry.id })),
					...imported.assets.map(asset => ({ type: 'asset' as const, assetId: asset.id })),
				],
			},
		};
	},
});

const setNodesEffectName = definePublicCommand({
	label: 'Set Nodes Effect name',
	description: 'Rename a registered Nodes Effect. To rename an inline Nodes Effect, rename its owning Timeline layer instead.',
	examples: ['let nodesEffect = Command:createNodesEffect({})\nCommand:setNodesEffectName({ target: nodesEffect, name: "Background" })'],
	inputSchema: z.object({ target: registeredNodesEffectTargetSchema, name: z.string() }),
	resultSchema: z.null(),
	prepare(state, input) {
		if (typeof input.name !== 'string') throw new Error('Nodes Effect name must be a string');
		const getRegistered = (current: ProjectState) => {
			const nodesEffect = current.nodesEffects.value.find(candidate => candidate.id === input.target.nodesEffectId);
			if (nodesEffect == null) throw new Error('Nodes Effect not found');
			return nodesEffect;
		};
		return prepareNodesEffectValue(getRegistered(state).name, input.name,
			(current, name) => { getRegistered(current).name = name; },
			[{ type: 'nodesEffectName', nodesEffectId: input.target.nodesEffectId }]);
	},
});

const createNodesEffectEffectNode = definePublicCommand({
	label: 'Create an effect node in a Nodes Effect',
	description: 'Create an Effect node using an effectSource and its defaults. A nested Nodes Effect cannot reference its containing Nodes Effect directly or indirectly. parameters supplies complete bindings by parameter name. staticSettings contains plain static values. appendToPrimaryOutput connects compatible primary ports to the existing chain. Omitted connectionMode is none. connectionTypePolicy defaults to strict.',
	examples: ['let nodesEffect = Command:createNodesEffect({})\nlet node = Command:createNodesEffectEffectNode({ nodesEffect: nodesEffect, effectSource: { type: "nativeEffect", id: "fill" }, connectionMode: "appendToPrimaryOutput" })\n<: Query:getNode(node)'],
	inputSchema: z.object({
		nodesEffect: nodesEffectTargetSchema, effectSource: effectSourceSchema, staticSettings: staticSettingValuesSchema.optional(),
		parameters: z.record(z.string(), nodesEffectParameterBindingSchema).nullish(),
		connectionMode: z.enum(['none', 'appendToPrimaryOutput']).nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish(),
	}),
	resultSchema: nodesEffectNodeReferenceSchema,
	prepare(state, input) {
		const definitions = getEffectDefinitions(state);
		const definition = definitions.describe(input.effectSource);
		if ('nodesEffectId' in input.nodesEffect && (input.effectSource.type === 'nodesEffectReference' || input.effectSource.type === 'inlineNodesEffect')) {
			const wouldCreateCycle = createEffectNodeCycleCheck(state.nodesEffects.value, input.nodesEffect.nodesEffectId);
			if (wouldCreateCycle(input.effectSource)) throw new Error('Cyclic Nodes Effect reference');
		}
		if (input.connectionMode != null && !['none', 'appendToPrimaryOutput'].includes(input.connectionMode)) throw new Error('Invalid connection mode');

		const connectionTypePolicy = input.connectionTypePolicy ?? 'strict';
		const target = { nodesEffect: deepClone(input.nodesEffect), nodeId: genId() };
		return prepareNodesEffectFields(state, input.nodesEffect, ['nodes'], nodesEffect => {
			const globalOut = input.connectionMode === 'appendToPrimaryOutput' ? nodesEffect.nodes.find(node => node.type === 'globalOut') : null;
			const primaryOutput = nodesEffect.outputDefs.find(output => output.id === nodesEffect.primaryOutputId);
			const previousInput = primaryOutput == null ? null : globalOut?.inputs[primaryOutput.id];
			const previous = previousInput?.nodeId == null ? null : nodesEffect.nodes.find(node => node.id === previousInput.nodeId);
			const parameters: NodesEffectEffectNode['params'] = {};
			for (const [key, parameterDefinition] of Object.entries(definition.paramDefs)) {
				parameters[key] = createDefaultParameterBinding(parameterDefinition);
				if (key !== definition.primaryInputParameter || previousInput?.nodeId == null) continue;
				const output = getNodeOutputs(previous, nodesEffect.paramDefs, definitions)[previousInput.outputPort];
				if (canConnectNodeDataTypes(output?.dataType, getNodeInputDataType(parameterDefinition), connectionTypePolicy)) {
					parameters[key] = { inputSource: 'node', ...deepClone(previousInput), fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
				}
			}
			for (const key of Object.keys(input.parameters ?? {})) {
				if (!Object.hasOwn(definition.paramDefs, key)) throw new Error('Unknown effect parameter: ' + key);
			}
			const addedNode: NodesEffectEffectNode = {
				id: target.nodeId, type: 'effect', effectSource: input.effectSource, displayName: '', isBypass: false,
				resolution: { mode: 'auto', scale: 1 },
				staticSettings: createStaticSettingValues(definition.staticSettingDefs ?? {}, input.staticSettings),
				params: { ...parameters, ...deepClone(input.parameters ?? {}) }, pos: { x: 0, y: 0 },
			};
			for (const [key, parameterDefinition] of Object.entries(definition.paramDefs)) {
				validateNodesEffectNodeParameterBinding(state, nodesEffect, parameterDefinition, addedNode.params[key], null, connectionTypePolicy);
			}
			const outputIndex = nodesEffect.nodes.findIndex(node => node.type === 'globalOut');
			nodesEffect.nodes.splice(outputIndex < 0 ? nodesEffect.nodes.length : outputIndex, 0, addedNode);
			const primaryPort = definition.primaryOutput;
			if (globalOut != null && primaryOutput != null && primaryPort != null
				&& canConnectNodeDataTypes(definition.outputDefs[primaryPort]?.dataType, primaryOutput.dataType, connectionTypePolicy)) {
				globalOut.inputs[primaryOutput.id] = { nodeId: target.nodeId, outputPort: primaryPort };
			}
			return target;
		});
	},
});

const createNodesEffectRelayNode = definePublicCommand({
	label: 'Create Nodes Effect relay node',
	description: 'Create a disconnected relay node with data type any, before the Nodes Effect Out node. Returns a node target for setNodesEffectRelayInput and Query:getNode. The relay output port is "output".',
	examples: ['let nodesEffect = Command:createNodesEffect({})\nlet relay = Command:createNodesEffectRelayNode({ nodesEffect: nodesEffect })\n<: Query:getNode(relay)'],
	inputSchema: z.object({ nodesEffect: nodesEffectTargetSchema }),
	resultSchema: nodesEffectNodeReferenceSchema,
	prepare(state, input) {
		const target = { nodesEffect: deepClone(input.nodesEffect), nodeId: genId() };
		return prepareNodesEffectFields(state, target.nodesEffect, ['nodes'], nodesEffect => {
			// 作成時は未接続なので、後から任意のテクスチャ型を中継できる宣言型で追加する。
			const node: NodesEffectRelayNode = { id: target.nodeId, type: 'relay', dataType: { kind: 'any' }, input: { nodeId: null, outputPort: null } };
			const outputIndex = nodesEffect.nodes.findIndex(candidate => candidate.type === 'globalOut');
			nodesEffect.nodes.splice(outputIndex < 0 ? nodesEffect.nodes.length : outputIndex, 0, node);
			return target;
		});
	},
});

const setNodesEffectRelayInput = definePublicCommand({
	label: 'Set Nodes Effect relay input',
	description: 'Connect a relay node to an output port of another node in the same Nodes Effect. Pass source: null to disconnect. The relay passes the source through unchanged. connectionTypePolicy defaults to strict.',
	examples: ['let nodesEffect = Command:createNodesEffect({})\nlet source = Command:createNodesEffectEffectNode({ nodesEffect: nodesEffect, effectSource: { type: "nativeEffect", id: "fill" } })\nlet relay = Command:createNodesEffectRelayNode({ nodesEffect: nodesEffect })\nCommand:setNodesEffectRelayInput({ target: relay, source: { nodeId: source.nodeId, outputPort: "output" } })'],
	inputSchema: z.object({
		target: nodesEffectNodeReferenceSchema,
		source: nodesEffectNodeOutputReferenceSchema.nullable(),
		connectionTypePolicy: connectionTypePolicySchema.nullish(),
	}),
	resultSchema: z.null(),
	prepare(state, input) {
		const relayNode = getNodesEffectRelayNode(state, input.target);
		const source = input.source;
		if (source != null) {
			if (source.nodeId === relayNode.id) throw new Error('Relay node cannot connect to itself');
			const nodesEffect = getNodesEffect(state, input.target.nodesEffect);
			const sourceNode = nodesEffect.nodes.find(candidate => candidate.id === source.nodeId);
			const output = getNodeOutputs(sourceNode, nodesEffect.paramDefs, getEffectDefinitions(state))[source.outputPort];
			if (output == null) throw new Error('Node output not found in this Nodes Effect');
			if (!canConnectNodeDataTypes(output.dataType, relayNode.dataType, input.connectionTypePolicy ?? 'strict')) throw new Error('Node output type does not match the relay input');
		}
		// 出力元だけを保存し、サンプリングはRelayを参照する側の接続に任せる。
		const after: NodesEffectRelayNode['input'] = source == null
			? { nodeId: null, outputPort: null }
			: { nodeId: source.nodeId, outputPort: source.outputPort };
		return prepareNodesEffectValue(relayNode.input, after,
			(currentState, value) => { getNodesEffectRelayNode(currentState, input.target).input = value; },
			[{ type: 'nodesEffect', target: input.target.nodesEffect }]);
	},
});

const setNodesEffectRelayDataType = definePublicCommand({
	label: 'Set Nodes Effect relay data type',
	description: 'Set the declared input and output data type of a relay node. Retains existing connections and passes through the original data without conversion.',
	examples: ['let nodesEffect = Command:createNodesEffect({})\nlet relay = Command:createNodesEffectRelayNode({ nodesEffect: nodesEffect })\nCommand:setNodesEffectRelayDataType({ target: relay, dataType: { kind: "scalar" } })'],
	inputSchema: z.object({ target: nodesEffectNodeReferenceSchema, dataType: textureDataTypeSchema }),
	resultSchema: z.null(),
	prepare(state, { target, dataType }) {
		const relayNode = getNodesEffectRelayNode(state, target);
		return prepareNodesEffectValue(relayNode.dataType, { kind: dataType.kind },
			(currentState, value) => { getNodesEffectRelayNode(currentState, target).dataType = value; },
			[{ type: 'nodesEffect', target: target.nodesEffect }]);
	},
});

function getNodesEffectRelayNode(state: ProjectState, target: NodesEffectNodeReference): NodesEffectRelayNode {
	const node = stateUtility.findNode(state, { ...target.nodesEffect, nodeId: target.nodeId });
	if (node?.type !== 'relay') throw new Error('Nodes Effect relay node not found');
	return node;
}

const moveNodesEffectNode = definePublicCommand({
	label: 'Move Nodes Effect node',
	description: 'Move a node to an absolute zero-based index in the Nodes Effect node array. The In/Out nodes cannot move, and their reserved end positions cannot be occupied. This changes order, not canvas coordinates.',
	examples: ['let nodesEffect = Command:createNodesEffect({})\nlet node = Command:createNodesEffectEffectNode({ nodesEffect: nodesEffect, effectSource: { type: "nativeEffect", id: "fill" } })\nCommand:moveNodesEffectNode({ target: node, index: 1 })'],
	inputSchema: z.object({ target: nodesEffectNodeReferenceSchema, index: z.number().int() }),
	resultSchema: z.null(),
	prepare(state, input) {
		return prepareNodesEffectFields(state, input.target.nodesEffect, ['nodes'], nodesEffect => {
			const nodes = nodesEffect.nodes;
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

const removeNodesEffectNode = definePublicCommand({
	label: 'Remove Nodes Effect node',
	description: 'Remove an effect or relay node. In/Out nodes cannot be removed. reconnection defaults to disconnect; primaryInput reconnects consumers to the removed node\'s compatible primary input when possible. connectionTypePolicy defaults to strict. Existing expressions are not rewritten.',
	examples: ['let nodesEffect = Command:createNodesEffect({})\nlet node = Command:createNodesEffectEffectNode({ nodesEffect: nodesEffect, effectSource: { type: "nativeEffect", id: "fill" } })\nCommand:removeNodesEffectNode({ target: node, reconnection: "disconnect" })'],
	inputSchema: z.object({ target: nodesEffectNodeReferenceSchema, reconnection: z.enum(['disconnect', 'primaryInput']).nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish() }),
	resultSchema: z.null(),
	prepare(state, input) {
		if (input.reconnection != null && !['disconnect', 'primaryInput'].includes(input.reconnection)) throw new Error('Invalid reconnection mode');
		const connectionTypePolicy = input.connectionTypePolicy ?? 'strict';
		const definitions = getEffectDefinitions(state);
		return prepareNodesEffectFields(state, input.target.nodesEffect, ['nodes'], nodesEffect => {
			const removedNode = nodesEffect.nodes.find(node => node.id === input.target.nodeId);
			if (removedNode == null) throw new Error('Node not found');
			if (removedNode.type === 'globalIn' || removedNode.type === 'globalOut') throw new Error('In/Out nodes cannot be removed');
			const primary = removedNode.type === 'effect' ? definitions.describe(removedNode.effectSource)?.primaryInputParameter : null;
			const binding = removedNode.type === 'relay' ? { inputSource: 'node' as const, ...removedNode.input } : primary == null ? null : removedNode.params[primary];
			const replacement: Pick<NodeOutputReference, 'nodeId' | 'outputPort'> | null = input.reconnection === 'primaryInput'
				&& binding?.inputSource === 'node' && binding.nodeId != null && binding.nodeId !== input.target.nodeId
				? { nodeId: binding.nodeId, outputPort: binding.outputPort } : null;
			const replacementOutput = replacement == null ? null : getNodeOutputs(nodesEffect.nodes.find(node => node.id === replacement.nodeId), nodesEffect.paramDefs, definitions)[replacement.outputPort];
			for (const node of nodesEffect.nodes) {
				if (node.id === input.target.nodeId) continue;
				if (node.type === 'globalOut') {
					for (const [id, connection] of Object.entries(node.inputs)) {
						if (connection.nodeId !== input.target.nodeId) continue;
						const definition = nodesEffect.outputDefs.find(output => output.id === id);
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
			nodesEffect.nodes = nodesEffect.nodes.filter(node => node.id !== input.target.nodeId);
		});
	},
});

export const NODES_EFFECT_COMMAND_DEFS = {
	createNodesEffect, importNodesEffect, setNodesEffectName,
	createNodesEffectEffectNode, createNodesEffectRelayNode, setNodesEffectRelayInput, setNodesEffectRelayDataType, moveNodesEffectNode, removeNodesEffectNode,
};
