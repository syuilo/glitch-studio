import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { z } from 'zod';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { createProjectVisualModule } from '../utility/project-visual-module.ts';
import { getVisualModule } from '../utility/visual-module-target.ts';
import { resolveNodeParam, walkNodeParams } from '../utility/node-params.ts';
import { validateVisualModuleNodeParameterBinding } from './visual-module-parameter-validation.ts';
import { defineCommand, definePublicCommand } from './definition.ts';
import { staticSettingValuesSchema } from './parameter-contract-schemas.ts';
import { connectionTypePolicySchema, registeredVisualModuleTargetSchema, visualModuleNodeReferenceSchema, visualModuleParameterBindingSchema, visualModuleTargetSchema } from './visual-module-contract-schemas.ts';
import { prepareVisualModuleFields, prepareVisualModuleValue } from './visual-module-change.ts';
import type { VisualModuleEffectNode, VisualModuleNode, NodeOutputReference } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ProjectState } from '../Project.ts';
import type { VisualModuleImport } from '../gsvm.ts';
import type { NodeParamTarget as EffectNodeParameterTarget } from '../utility/node-params.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';

export type { VisualModuleNodeReference } from './visual-module-change.ts';
export type NodeTarget = VisualModuleTarget & { nodeId: string };
export type NodeParamTarget = EffectNodeParameterTarget & VisualModuleTarget;
export type ConnectionTypePolicy = 'strict' | 'allowMismatch';

// 所在の解決だけを共有する。環境設定やUIの選択はここでは参照しない。
export const stateUtility = {
	getVisualModule,
	findNode: (state: ProjectState, target: NodeTarget): VisualModuleNode | null =>
		getVisualModule(state, target).nodes.find(node => node.id === target.nodeId) ?? null,
};

export function canConnectVisualModuleTypes(output: TextureDataType | null | undefined, input: TextureDataType | null, policy: ConnectionTypePolicy): boolean {
	if (output == null || input == null) return false;
	return policy === 'allowMismatch' || areNodeDataTypesCompatible(output, input);
}

const createVisualModule = definePublicCommand({
	label: 'Create Visual Module',
	description: 'Create a registered Visual Module with its default In/Out nodes and color output. An omitted or null name uses the next default name. Returns a target for subsequent Commands and Queries.',
	examples: ['let visualModule = Command:createVisualModule({ name: "Generated" })\n<: Query:getVisualModule(visualModule)'],
	inputSchema: z.object({ name: z.string().nullish() }),
	resultSchema: registeredVisualModuleTargetSchema,
	prepare(state, input) {
		if (input.name != null && typeof input.name !== 'string') throw new Error('Visual Module name must be a string');
		const visualModule = createProjectVisualModule(state.visualModules.value.length);
		if (input.name != null) visualModule.name = input.name;
		const target = { visualModuleId: visualModule.id };
		return {
			result: target,
			change: {
				apply(current) { current.visualModules.value.push(deepClone(visualModule)); },
				revert(current) { current.visualModules.value = current.visualModules.value.filter(candidate => candidate.id !== visualModule.id); },
				changes: [{ type: 'visualModuleRegistration', visualModuleId: visualModule.id }],
			},
		};
	},
});

// 取り込みでは読み取り済みの素材を含むため、通常の生成とは異なる内部入力を受け取る。
const importVisualModule = defineCommand<VisualModuleImport, { visualModuleId: string }>({
	label: 'Import Visual Module',
	prepare(state, input) {
		const imported = deepClone(input);
		if (state.visualModules.value.some(visualModule => visualModule.id === imported.visualModule.id)) throw new Error('Visual Module ID already exists');
		for (const [existing, added] of [[state.assets.value, imported.assets], [state.players.value, imported.players]]) {
			const ids = new Set(existing.map(resource => resource.id));
			for (const resource of added) {
				if (ids.has(resource.id)) throw new Error('Resource ID already exists');
				ids.add(resource.id);
			}
		}
		const assetIds = new Set(imported.assets.map(asset => asset.id));
		const playerIds = new Set(imported.players.map(player => player.id));
		return {
			result: { visualModuleId: imported.visualModule.id },
			change: {
				apply(current) {
					current.assets.value.push(...deepClone(imported.assets));
					current.players.value.push(...deepClone(imported.players));
					current.visualModules.value.push(deepClone(imported.visualModule));
				},
				revert(current) {
					current.visualModules.value = current.visualModules.value.filter(visualModule => visualModule.id !== imported.visualModule.id);
					current.assets.value = current.assets.value.filter(asset => !assetIds.has(asset.id));
					current.players.value = current.players.value.filter(player => !playerIds.has(player.id));
				},
				changes: [
					{ type: 'visualModuleRegistration', visualModuleId: imported.visualModule.id },
					...imported.assets.map(asset => ({ type: 'asset' as const, assetId: asset.id })),
					...imported.players.map(player => ({ type: 'player' as const, playerId: player.id })),
				],
			},
		};
	},
});

const setVisualModuleName = definePublicCommand({
	label: 'Set Visual Module name',
	description: 'Rename a registered Visual Module. To rename an inline Visual Module, rename its owning Timeline layer instead.',
	examples: ['let visualModule = Command:createVisualModule({})\nCommand:setVisualModuleName({ target: visualModule, name: "Background" })'],
	inputSchema: z.object({ target: registeredVisualModuleTargetSchema, name: z.string() }),
	resultSchema: z.null(),
	prepare(state, input) {
		if (typeof input.name !== 'string') throw new Error('Visual Module name must be a string');
		const getRegistered = (current: ProjectState) => {
			const visualModule = current.visualModules.value.find(candidate => candidate.id === input.target.visualModuleId);
			if (visualModule == null) throw new Error('Visual Module not found');
			return visualModule;
		};
		return prepareVisualModuleValue(getRegistered(state).name, input.name,
			(current, name) => { getRegistered(current).name = name; },
			[{ type: 'visualModuleName', visualModuleId: input.target.visualModuleId }]);
	},
});

const createVisualModuleEffectNode = definePublicCommand({
	label: 'Create Visual Module effect node',
	description: 'Create an effect node using the current effect definition and defaults. parameters supplies complete bindings by parameter name; staticSettings contains plain static values. appendToPrimaryOutput connects compatible primary inputs/outputs to the existing chain. Omitted connectionMode is none, and omitted connectionTypePolicy is strict.',
	examples: ['let visualModule = Command:createVisualModule({})\nlet node = Command:createVisualModuleEffectNode({ visualModule: visualModule, effectId: "fill", connectionMode: "appendToPrimaryOutput" })\n<: Query:getNode(node)'],
	inputSchema: z.object({
		visualModule: visualModuleTargetSchema, effectId: z.string(), staticSettings: staticSettingValuesSchema.optional(),
		parameters: z.record(z.string(), visualModuleParameterBindingSchema).nullish(),
		connectionMode: z.enum(['none', 'appendToPrimaryOutput']).nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish(),
	}),
	resultSchema: visualModuleNodeReferenceSchema,
	prepare(state, input) {
		const definitions = getEffectDefinitions(state);
		const definition = definitions[input.effectId];
		if (definition == null) throw new Error('Effect not found');
		if (input.connectionMode != null && !['none', 'appendToPrimaryOutput'].includes(input.connectionMode)) throw new Error('Invalid connection mode');
		const policy = input.connectionTypePolicy ?? 'strict';
		if (policy !== 'strict' && policy !== 'allowMismatch') throw new Error('Invalid connection type policy');
		const target = { visualModule: deepClone(input.visualModule), nodeId: genId() };
		return prepareVisualModuleFields(state, input.visualModule, ['nodes'], visualModule => {
			const globalOut = input.connectionMode === 'appendToPrimaryOutput' ? visualModule.nodes.find(node => node.type === 'globalOut') : null;
			const primaryOutput = visualModule.outputDefs.find(output => output.id === visualModule.primaryOutputId);
			const previousInput = primaryOutput == null ? null : globalOut?.inputs[primaryOutput.id];
			const previous = previousInput?.nodeId == null ? null : visualModule.nodes.find(node => node.id === previousInput.nodeId);
			const parameters: VisualModuleEffectNode['params'] = {};
			for (const [key, parameterDefinition] of Object.entries(definition.paramDefs)) {
				parameters[key] = deepClone(parameterDefinition.defaultValue);
				if (key !== definition.primaryInputParameter || previousInput?.nodeId == null) continue;
				const output = getNodeOutputs(previous, visualModule.paramDefs, definitions)[previousInput.outputPort];
				if (canConnectVisualModuleTypes(output?.dataType, getNodeInputDataType(parameterDefinition), policy)) {
					parameters[key] = { inputSource: 'node', ...deepClone(previousInput), fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
				}
			}
			for (const key of Object.keys(input.parameters ?? {})) {
				if (!Object.hasOwn(definition.paramDefs, key)) throw new Error('Unknown effect parameter: ' + key);
			}
			const addedNode: VisualModuleEffectNode = {
				id: target.nodeId, type: 'effect', effectId: input.effectId, displayName: '', isBypass: false,
				resolution: { mode: 'auto', scale: 1 },
				staticSettings: createStaticSettingValues(definition.staticSettingDefs ?? {}, input.staticSettings),
				params: { ...parameters, ...deepClone(input.parameters ?? {}) }, pos: { x: 0, y: 0 },
			};
			for (const [key, parameterDefinition] of Object.entries(definition.paramDefs)) {
				validateVisualModuleNodeParameterBinding(state, visualModule, parameterDefinition, addedNode.params[key], policy);
			}
			const outputIndex = visualModule.nodes.findIndex(node => node.type === 'globalOut');
			visualModule.nodes.splice(outputIndex < 0 ? visualModule.nodes.length : outputIndex, 0, addedNode);
			const primaryPort = definition.primaryOutput;
			if (globalOut != null && primaryOutput != null && primaryPort != null
				&& canConnectVisualModuleTypes(definition.outputDefs[primaryPort]?.dataType, primaryOutput.dataType, policy)) {
				globalOut.inputs[primaryOutput.id] = { nodeId: target.nodeId, outputPort: primaryPort };
			}
			return target;
		});
	},
});

const moveVisualModuleNode = definePublicCommand({
	label: 'Move Visual Module node',
	description: 'Move a node to an absolute zero-based index in the Visual Module node array. The In/Out nodes cannot move, and their reserved end positions cannot be occupied. This changes order, not canvas coordinates.',
	examples: ['let visualModule = Command:createVisualModule({})\nlet node = Command:createVisualModuleEffectNode({ visualModule: visualModule, effectId: "fill" })\nCommand:moveVisualModuleNode({ target: node, index: 1 })'],
	inputSchema: z.object({ target: visualModuleNodeReferenceSchema, index: z.number().int() }),
	resultSchema: z.null(),
	prepare(state, input) {
		return prepareVisualModuleFields(state, input.target.visualModule, ['nodes'], visualModule => {
			const nodes = visualModule.nodes;
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

const removeVisualModuleNode = definePublicCommand({
	label: 'Remove Visual Module node',
	description: 'Remove an effect or relay node. In/Out nodes cannot be removed. reconnection defaults to disconnect; primaryInput reconnects consumers to the removed node\'s compatible primary input when possible. Existing expressions are not rewritten.',
	examples: ['let visualModule = Command:createVisualModule({})\nlet node = Command:createVisualModuleEffectNode({ visualModule: visualModule, effectId: "fill" })\nCommand:removeVisualModuleNode({ target: node, reconnection: "disconnect" })'],
	inputSchema: z.object({ target: visualModuleNodeReferenceSchema, reconnection: z.enum(['disconnect', 'primaryInput']).nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish() }),
	resultSchema: z.null(),
	prepare(state, input) {
		const policy = input.connectionTypePolicy ?? 'strict';
		if (policy !== 'strict' && policy !== 'allowMismatch') throw new Error('Invalid connection type policy');
		if (input.reconnection != null && !['disconnect', 'primaryInput'].includes(input.reconnection)) throw new Error('Invalid reconnection mode');
		const definitions = getEffectDefinitions(state);
		return prepareVisualModuleFields(state, input.target.visualModule, ['nodes'], visualModule => {
			const removedNode = visualModule.nodes.find(node => node.id === input.target.nodeId);
			if (removedNode == null) throw new Error('Node not found');
			if (removedNode.type === 'globalIn' || removedNode.type === 'globalOut') throw new Error('In/Out nodes cannot be removed');
			const primary = removedNode.type === 'effect' ? definitions[removedNode.effectId]?.primaryInputParameter : null;
			const binding = removedNode.type === 'relay' ? { inputSource: 'node' as const, ...removedNode.input } : primary == null ? null : removedNode.params[primary];
			const replacement: Pick<NodeOutputReference, 'nodeId' | 'outputPort'> | null = input.reconnection === 'primaryInput'
				&& binding?.inputSource === 'node' && binding.nodeId != null && binding.nodeId !== input.target.nodeId
				? { nodeId: binding.nodeId, outputPort: binding.outputPort } : null;
			const replacementOutput = replacement == null ? null : getNodeOutputs(visualModule.nodes.find(node => node.id === replacement.nodeId), visualModule.paramDefs, definitions)[replacement.outputPort];
			for (const node of visualModule.nodes) {
				if (node.id === input.target.nodeId) continue;
				if (node.type === 'globalOut') {
					for (const [id, connection] of Object.entries(node.inputs)) {
						if (connection.nodeId !== input.target.nodeId) continue;
						const definition = visualModule.outputDefs.find(output => output.id === id);
						node.inputs[id] = replacement != null && canConnectVisualModuleTypes(replacementOutput?.dataType, definition?.dataType ?? null, policy)
							? deepClone(replacement) : { nodeId: null, outputPort: null };
					}
				} else if (node.type === 'relay') {
					if (node.input.nodeId === input.target.nodeId) {
						node.input = replacement != null && canConnectVisualModuleTypes(replacementOutput?.dataType, node.dataType, policy)
							? deepClone(replacement) : { nodeId: null, outputPort: null };
					}
				} else if (node.type === 'effect') {
					for (const { path, def, value } of walkNodeParams(node, definitions)) {
						if (!def.canNode || value.inputSource !== 'node' || value.nodeId !== input.target.nodeId) continue;
						const compatible = replacement != null && canConnectVisualModuleTypes(replacementOutput?.dataType, getNodeInputDataType(def), policy);
						resolveNodeParam(node, path, definitions).setValue(compatible
							? { ...deepClone(value), ...deepClone(replacement) }
							: { inputSource: 'node', nodeId: null, outputPort: null });
					}
				}
			}
			visualModule.nodes = visualModule.nodes.filter(node => node.id !== input.target.nodeId);
		});
	},
});

export const VISUAL_MODULE_COMMAND_DEFS = {
	createVisualModule, importVisualModule, setVisualModuleName,
	createVisualModuleEffectNode, moveVisualModuleNode, removeVisualModuleNode,
};
