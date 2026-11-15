import { genId } from '@gs/shared/utility/id.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { matchesAssetReferenceMimeType } from '@gs/shared/data-type/asset-reference.ts';
import { validateStaticSettingValue } from '@gs/shared/static-setting.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import { visualModuleTargetKey } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import { getVisualModule, listVisualModules } from '../utility/visual-module-target.ts';
import { createProjectVisualModule } from '../utility/project-visual-module.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { resolveNodeParam } from '../utility/node-params.ts';
import { scriptBoolean, scriptFunction, scriptKeys, scriptObject, scriptString } from './script-values.ts';
import type { ScriptApiFunction } from './script-values.ts';
import type { ProjectContext, ProjectState } from '../Project.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { NodeOutputReference, VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { StaticSettingDefinition, StaticSettingValues } from '@gs/shared/static-setting.ts';

type ScriptNodeReference = { visualModule: VisualModuleTarget; nodeId: string };
type ProjectScriptCommands = Pick<ProjectContext['stateManager'], 'commit'>;

function readVisualModuleReference(value: unknown): VisualModuleTarget {
	const reference = scriptObject(value);
	if (Object.hasOwn(reference, 'visualModuleId')) {
		scriptKeys(reference, ['visualModuleId']);
		return { visualModuleId: scriptString(reference.visualModuleId) };
	}
	scriptKeys(reference, ['sceneId', 'inlineVisualModuleLayerId']);
	return { sceneId: scriptString(reference.sceneId), inlineVisualModuleLayerId: scriptString(reference.inlineVisualModuleLayerId) };
}

function readNodeReference(value: unknown): ScriptNodeReference {
	const reference = scriptObject(value);
	scriptKeys(reference, ['visualModule', 'nodeId']);
	return { visualModule: readVisualModuleReference(reference.visualModule), nodeId: scriptString(reference.nodeId) };
}

function readParameterPath(value: unknown): ParamPath {
	if (!Array.isArray(value) || value.length === 0) throw new Error('Expected a non-empty parameter path');
	return value.map(scriptString) as [string, ...string[]];
}

function validateStaticReference(state: ProjectState, definition: StaticSettingDefinition, value: unknown): void {
	validateStaticSettingValue(definition, value);
	if (value == null) return;
	if (definition.dataType.kind === 'assetReference') {
		const asset = state.assets.value.find(asset => asset.id === value);
		if (asset == null) throw new Error('Asset not found');
		if (!matchesAssetReferenceMimeType(definition.dataType, asset.fileDataType)) throw new Error('Incompatible asset type');
	}
	if (definition.dataType.kind === 'playerReference' && !state.players.value.some(player => player.id === value)) throw new Error('Player not found');
}

/** プロジェクト内容の操作だけを公開する。UIの選択・保存・レンダラーの評価結果には依存しない。 */
export function createProjectScriptApi(state: ProjectState, commands: ProjectScriptCommands): Record<string, ScriptApiFunction> {
	const definitions = () => getEffectDefinitions(state);
	const effectDefinition = (value: unknown) => {
		const id = scriptString(value);
		const all = definitions();
		if (!Object.hasOwn(all, id)) throw new Error('Effect not found: ' + id);
		return all[id];
	};
	const visualModule = (value: unknown) => {
		const target = readVisualModuleReference(value);
		return { target, definition: getVisualModule(state, target) };
	};
	const node = (value: unknown) => {
		const reference = readNodeReference(value);
		const definition = getVisualModule(state, reference.visualModule);
		const found = definition.nodes.find(item => item.id === reference.nodeId);
		if (found == null) throw new Error('Node not found: ' + reference.nodeId);
		return { reference, visualModule: definition, node: found, target: { ...reference.visualModule, nodeId: reference.nodeId } };
	};
	const effectNode = (value: unknown) => {
		const found = node(value);
		if (found.node.type !== 'effect') throw new Error('Expected an effect node');
		return { ...found, node: found.node as VisualModuleEffectNode };
	};
	const parameter = (reference: unknown, path: unknown) => {
		const found = effectNode(reference);
		const paramPath = readParameterPath(path);
		return { ...resolveNodeParam(found.node, paramPath, definitions()), target: { ...found.target, paramPath } };
	};
	const sourceOutput = (value: unknown, port: unknown) => {
		const found = node(value);
		const outputPort = scriptString(port);
		const outputs = getNodeOutputs(found.node, found.visualModule.paramDefs, definitions());
		if (!Object.hasOwn(outputs, outputPort)) throw new Error('Node output not found: ' + outputPort);
		return { ...found, outputPort, output: outputs[outputPort] };
	};
	const sameVisualModule = (a: VisualModuleTarget, b: VisualModuleTarget) => {
		if (visualModuleTargetKey(a) !== visualModuleTargetKey(b)) throw new Error('Nodes must belong to the same Visual Module');
	};
	const registeredReference = (value: unknown) => {
		const found = visualModule(value);
		if (!('visualModuleId' in found.target)) throw new Error('This operation requires a registered Visual Module');
		return found.target;
	};
	const assetInfo = (asset: ProjectState['assets']['value'][number]) => ({
		id: asset.id, name: asset.name, width: asset.width, height: asset.height, fileDataType: asset.fileDataType,
	});
	const visualModuleInfo = (target: VisualModuleTarget) => ({
		...getVisualModule(state, target), reference: target,
		name: 'visualModuleId' in target ? state.visualModules.value.find(item => item.id === target.visualModuleId)!.name : null,
	});
	const nodeInfo = (reference: ScriptNodeReference) => ({ ...node(reference).node, reference });
	const sampling = (): Pick<NodeOutputReference, 'fitMode' | 'wrapMode' | 'filterMode'> => ({ fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });

	return {
		'Project:get': scriptFunction(0, 0, () => ({
			name: state.name.value, description: state.description.value, author: state.author.value,
			resolution: state.resolution.value, timelineFps: state.timelineFps.value,
			// Playerの作成・再生は公開しないが、既存Playerを静的設定で参照できるようIDを返す。
			players: state.players.value,
		})),
		'Asset:list': scriptFunction(0, 0, () => state.assets.value.map(assetInfo)),
		'Asset:get': scriptFunction(1, 1, value => {
			const id = scriptString(value);
			const asset = state.assets.value.find(item => item.id === id);
			if (asset == null) throw new Error('Asset not found: ' + id);
			return assetInfo(asset);
		}),
		'Effect:list': scriptFunction(0, 0, () => Object.values(definitions()).map(definition => ({ id: definition.id, displayName: definition.displayName }))),
		'Effect:get': scriptFunction(1, 1, id => {
			const definition = effectDefinition(id);
			return { id: definition.id, displayName: definition.displayName, description: definition.description,
				paramDefs: definition.paramDefs, staticSettingDefs: definition.staticSettingDefs ?? {},
				outputDefs: definition.outputDefs, primaryInputParameter: definition.primaryInputParameter, primaryOutput: definition.primaryOutput };
		}),
		'VisualModule:list': scriptFunction(0, 0, () => listVisualModules(state).map(({ target }) => ({
			reference: target, name: visualModuleInfo(target).name,
		}))),
		'VisualModule:get': scriptFunction(1, 1, reference => visualModuleInfo(visualModule(reference).target)),
		'VisualModule:create': scriptFunction(1, 1, value => {
			const name = scriptString(value);
			const definition = createProjectVisualModule(state.visualModules.value.length);
			definition.name = name;
			commands.commit('addVisualModule', { visualModule: definition });
			return { visualModuleId: definition.id };
		}),
		'VisualModule:rename': scriptFunction(2, 2, (reference, name) => commands.commit('renameVisualModule', {
			...registeredReference(reference), name: scriptString(name),
		})),
		'VisualModule:remove': scriptFunction(1, 1, reference => commands.commit('removeVisualModule', registeredReference(reference))),
		'VisualModule:connectOutput': scriptFunction(4, 4, (reference, outputId, sourceReference, outputPort) => {
			const destination = visualModule(reference);
			const id = scriptString(outputId);
			const output = destination.definition.outputDefs.find(item => item.id === id);
			if (output == null) throw new Error('Visual Module output not found');
			const source = sourceOutput(sourceReference, outputPort);
			sameVisualModule(destination.target, source.reference.visualModule);
			if (!areNodeDataTypesCompatible(source.output.dataType, output.dataType)) throw new Error('Incompatible output data types');
			const globalOut = destination.definition.nodes.find(item => item.type === 'globalOut');
			if (globalOut == null) throw new Error('Global output node not found');
			commands.commit('updateGlobalOutInput', { ...destination.target, nodeId: globalOut.id, outputId: id,
				value: { nodeId: source.node.id, outputPort: source.outputPort, ...sampling() } });
		}),
		'VisualModule:disconnectOutput': scriptFunction(2, 2, (reference, outputId) => {
			const destination = visualModule(reference);
			const globalOut = destination.definition.nodes.find(item => item.type === 'globalOut');
			if (globalOut == null) throw new Error('Global output node not found');
			commands.commit('updateGlobalOutInput', { ...destination.target, nodeId: globalOut.id, outputId: scriptString(outputId), value: null });
		}),
		'VisualModule:Node:list': scriptFunction(1, 1, reference => {
			const found = visualModule(reference);
			return found.definition.nodes.map(item => nodeInfo({ visualModule: found.target, nodeId: item.id }));
		}),
		'VisualModule:Node:get': scriptFunction(1, 1, reference => nodeInfo(node(reference).reference)),
		'VisualModule:Node:getOutputs': scriptFunction(1, 1, reference => {
			const found = node(reference);
			return getNodeOutputs(found.node, found.visualModule.paramDefs, definitions());
		}),
		'VisualModule:Node:createEffect': scriptFunction(2, 3, (reference, effectId, settings) => {
			const found = visualModule(reference);
			const definition = effectDefinition(effectId);
			const staticSettings = settings == null ? {} : scriptObject(settings);
			for (const [key, value] of Object.entries(staticSettings)) {
				if (definition.staticSettingDefs == null || !Object.hasOwn(definition.staticSettingDefs, key)) throw new Error('Static setting not found: ' + key);
				validateStaticReference(state, definition.staticSettingDefs[key], value);
			}
			const id = genId();
			commands.commit('addEffectNode', { ...found.target, id, effectId: definition.id, staticSettings: staticSettings as StaticSettingValues, autoConnect: false });
			return { visualModule: found.target, nodeId: id };
		}),
		'VisualModule:Node:remove': scriptFunction(1, 1, reference => commands.commit('removeNode', effectNode(reference).target)),
		'VisualModule:Node:setDisplayName': scriptFunction(2, 2, (reference, name) => commands.commit('changeNodeDisplayName', {
			...effectNode(reference).target, displayName: scriptString(name),
		})),
		'VisualModule:Node:setBypass': scriptFunction(2, 2, (reference, enabled) => commands.commit('changeNodeBypassState', {
			...effectNode(reference).target, bypass: scriptBoolean(enabled),
		})),
		'VisualModule:Node:getParameter': scriptFunction(2, 2, (reference, path) => {
			const found = parameter(reference, path);
			return { definition: found.def, binding: found.value };
		}),
		'VisualModule:Node:setLiteral': scriptFunction(3, 3, (reference, path, value) => {
			const found = parameter(reference, path);
			if (found.def.dataType.kind === 'audioSource') {
				validatePlayerAudioSourceSelection(value);
				if (value != null && !state.players.value.some(player => player.id === value.playerId)) throw new Error('Player not found');
			} else {
				// 編集APIでは数値文字列を暗黙変換せず、型の間違いを変更前に報告する。
				if (found.def.dataType.kind === 'scalar' && typeof value !== 'number') throw new Error('Expected a number');
				prepareExpressionParameterValue(found.def, value);
			}
			commands.commit('updateParamAsLiteral', { ...found.target, value });
		}),
		'VisualModule:Node:setExpression': scriptFunction(3, 3, (reference, path, code) => {
			const found = parameter(reference, path);
			commands.commit('updateParamAsExpression', { ...found.target, value: scriptString(code) });
		}),
		'VisualModule:Node:setExpressionModifier': scriptFunction(3, 3, (reference, path, value) => {
			const found = parameter(reference, path);
			let modifier = null;
			if (value != null) {
				const record = scriptObject(value);
				scriptKeys(record, ['enabled', 'code']);
				modifier = { enabled: scriptBoolean(record.enabled), code: scriptString(record.code) };
			}
			commands.commit('updateParamExpressionModifier', { ...found.target, value: modifier });
		}),
		'VisualModule:Node:resetParameter': scriptFunction(2, 2, (reference, path) => commands.commit('resetNodeParam', parameter(reference, path).target)),
		'VisualModule:Node:getStaticSetting': scriptFunction(2, 2, (reference, setting) => {
			const found = effectNode(reference);
			const key = scriptString(setting);
			const definition = effectDefinition(found.node.effectId).staticSettingDefs;
			if (definition == null || !Object.hasOwn(definition, key)) throw new Error('Static setting not found: ' + key);
			return Object.hasOwn(found.node.staticSettings, key) ? found.node.staticSettings[key] : definition[key].defaultValue;
		}),
		'VisualModule:Node:setStaticSetting': scriptFunction(3, 3, (reference, setting, value) => {
			const found = effectNode(reference);
			const key = scriptString(setting);
			const definition = effectDefinition(found.node.effectId).staticSettingDefs;
			if (definition == null || !Object.hasOwn(definition, key)) throw new Error('Static setting not found: ' + key);
			validateStaticReference(state, definition[key], value);
			commands.commit('changeNodeStaticSetting', { ...found.target, key, value: value as StaticSettingValues[string] });
		}),
		'VisualModule:Node:connect': scriptFunction(4, 4, (sourceReference, port, destinationReference, path) => {
			const source = sourceOutput(sourceReference, port);
			const destination = effectNode(destinationReference);
			const found = parameter(destinationReference, path);
			sameVisualModule(source.reference.visualModule, destination.reference.visualModule);
			if (source.node.id === destination.node.id) throw new Error('A node cannot connect to itself');
			if (!areNodeDataTypesCompatible(source.output.dataType, getNodeInputDataType(found.def))) throw new Error('Incompatible parameter data types');
			commands.commit('updateParamAsNode', { ...found.target, preserveSampling: true,
				value: { nodeId: source.node.id, outputPort: source.outputPort, ...sampling() } });
		}),
		'VisualModule:Node:disconnect': scriptFunction(2, 2, (reference, path) => commands.commit('updateParamAsNode', {
			...parameter(reference, path).target, value: null, preserveSampling: false,
		})),
	};
}
