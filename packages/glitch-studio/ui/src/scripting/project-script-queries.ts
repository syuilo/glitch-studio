import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { getVisualModule, listVisualModules } from '../utility/visual-module-target.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { getLayerParameterDefinitions, getLayerParameterTargets, getLayerParameterValues } from '../utility/timeline-scene.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectAsset, ProjectState } from '../Project.ts';

type ProjectScriptQuery = (input: unknown) => unknown;

function inputObject(input: unknown): Record<string, unknown> {
	if (input == null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Query input must be an object');
	return input as Record<string, unknown>;
}

function identifier(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== 'string' || value.length === 0) throw new Error(`Query ${key} must be a non-empty string`);
	return value;
}

function visualModuleTarget(input: unknown): VisualModuleTarget {
	const reference = inputObject(input);
	if (reference.visualModuleId != null) return { visualModuleId: identifier(reference, 'visualModuleId') };
	return { sceneId: identifier(reference, 'sceneId'), inlineVisualModuleLayerId: identifier(reference, 'inlineVisualModuleLayerId') };
}

function snapshot<Value>(value: Value): Value {
	// 取得したデータの書き換えではプロジェクトや共通のEffect定義を編集できない。
	// ここへ渡す値は保存データと定義だけに限定し、Assetのバイナリは先に除く。
	return deepClone(value as never) as Value;
}

function assetMetadata(asset: ProjectAsset) {
	return {
		target: { assetId: asset.id },
		id: asset.id,
		name: asset.name,
		width: asset.width,
		height: asset.height,
		fileDataType: asset.fileDataType,
		hash: asset.hash ?? null,
		isExternalReference: asset.isExternalReference,
		sourceFilePath: asset.sourceFilePath,
	};
}

/**
 * 検索時点の保存内容を返す。式の評価・描画待ち・UIの選択は扱わない。
 * 一覧のtargetをそのまま取得関数やCommandの対象指定に渡せるよう、所在の形を揃える。
 */
export function createProjectScriptQueries(state: ProjectState): Record<string, ProjectScriptQuery> {
	function sceneReference(input: unknown) {
		const sceneId = identifier(inputObject(input), 'sceneId');
		const scene = state.timelineScenes.value.find(candidate => candidate.id === sceneId);
		if (scene == null) throw new Error(`Timeline Scene not found: ${sceneId}`);
		return { scene, target: { sceneId } };
	}

	function layerReference(input: unknown) {
		const { scene, target } = sceneReference(input);
		const layerId = identifier(inputObject(input), 'layerId');
		const layer = findTimelineLayer(scene.layers, layerId);
		if (layer == null) throw new Error(`Timeline Layer not found: ${layerId}`);
		return { scene, layer, target: { ...target, layerId } };
	}

	function visualModuleName(target: VisualModuleTarget): string {
		if ('visualModuleId' in target) {
			const visualModule = state.visualModules.value.find(candidate => candidate.id === target.visualModuleId);
			if (visualModule == null) throw new Error(`Visual Module not found: ${target.visualModuleId}`);
			return visualModule.name;
		}
		return layerReference({ sceneId: target.sceneId, layerId: target.inlineVisualModuleLayerId }).layer.name;
	}

	return {
		'Query:getProject': () => snapshot({
			name: state.name.value,
			description: state.description.value,
			author: state.author.value,
			resolution: state.resolution.value,
			timelineFps: state.timelineFps.value,
			timelineMotionBlur: state.timelineMotionBlur.value,
			exportSettings: state.exportSettings.value,
		}),
		'Query:listVisualModules': () => listVisualModules(state).map(({ target }) => ({ target, name: visualModuleName(target) })),
		'Query:getVisualModule': input => {
			const target = visualModuleTarget(input);
			const visualModule = getVisualModule(state, target);
			return snapshot({ ...visualModule, target, name: visualModuleName(target) });
		},
		'Query:listNodes': input => {
			const visualModule = visualModuleTarget(input);
			return snapshot(getVisualModule(state, visualModule).nodes.map(node => ({
				target: { visualModule, nodeId: node.id },
				id: node.id,
				type: node.type,
				effectId: node.type === 'effect' ? node.effectId : null,
				displayName: node.type === 'effect' ? node.displayName : node.type === 'relay' ? node.label ?? '' : '',
			})));
		},
		'Query:getNode': input => {
			const reference = inputObject(input);
			const visualModule = visualModuleTarget(reference.visualModule);
			const nodeId = identifier(reference, 'nodeId');
			const node = getVisualModule(state, visualModule).nodes.find(candidate => candidate.id === nodeId);
			if (node == null) throw new Error(`Visual Module Node not found: ${nodeId}`);
			return snapshot({ ...node, target: { visualModule, nodeId } });
		},
		'Query:listTimelineScenes': () => snapshot(state.timelineScenes.value.map(scene => ({ target: { sceneId: scene.id }, name: scene.name, resolution: scene.resolution }))),
		'Query:getTimelineScene': input => {
			const { scene, target } = sceneReference(input);
			return snapshot({ ...scene, target });
		},
		'Query:listTimelineLayers': input => {
			const { scene, target } = sceneReference(input);
			// 子孫を表示順に並べるが、参照先Sceneは辿らない。親IDで階層も復元できる。
			const layers: { target: { sceneId: string; layerId: string }; parentLayerId: string | null; name: string; layerType: TimelineLayer['layerType']; isDisabled: boolean; isSolo: boolean }[] = [];
			const visit = (children: readonly TimelineLayer[], parentLayerId: string | null) => {
				for (const layer of children) {
					layers.push({ target: { ...target, layerId: layer.id }, parentLayerId, name: layer.name, layerType: layer.layerType, isDisabled: layer.isDisabled, isSolo: layer.isSolo });
					if (isTimelineContainerLayer(layer)) visit(layer.layers, layer.id);
				}
			};
			visit(scene.layers, null);
			return layers;
		},
		'Query:getTimelineLayer': input => {
			const { layer, target } = layerReference(input);
			return snapshot({ ...layer, target });
		},
		'Query:getTimelineLayerParameters': input => {
			const { layer } = layerReference(input);
			// Commandは省略語を公開しないため、内部のmodule群をvisualModuleに揃える。
			return snapshot(Object.fromEntries(getLayerParameterTargets(layer).map(group => [group === 'module' ? 'visualModule' : group, {
				definitions: getLayerParameterDefinitions(state, layer, group),
				values: getLayerParameterValues(layer, group),
			}])));
		},
		'Query:listTimelineClips': input => {
			const { layer, target } = layerReference(input);
			return isTimelineContainerLayer(layer) ? [] : snapshot(layer.clips.map(clip => ({ ...clip, target: { ...target, clipId: clip.id } })));
		},
		'Query:getTimelineClip': input => {
			const { layer, target } = layerReference(input);
			const clipId = identifier(inputObject(input), 'clipId');
			const clip = isTimelineContainerLayer(layer) ? null : layer.clips.find(candidate => candidate.id === clipId);
			if (clip == null) throw new Error(`Timeline Clip not found: ${clipId}`);
			return snapshot({ ...clip, target: { ...target, clipId } });
		},
		'Query:listAssets': () => state.assets.value.map(assetMetadata),
		'Query:getAsset': input => {
			const assetId = identifier(inputObject(input), 'assetId');
			const asset = state.assets.value.find(candidate => candidate.id === assetId);
			if (asset == null) throw new Error(`Asset not found: ${assetId}`);
			return assetMetadata(asset);
		},
		'Query:listPlayers': () => snapshot(state.players.value.map(player => ({ ...player, target: { playerId: player.id } }))),
		'Query:getPlayer': input => {
			const playerId = identifier(inputObject(input), 'playerId');
			const player = state.players.value.find(candidate => candidate.id === playerId);
			if (player == null) throw new Error(`Player not found: ${playerId}`);
			return snapshot({ ...player, target: { playerId } });
		},
		'Query:listEffects': () => snapshot(Object.values(getEffectDefinitions(state)).map(effect => ({
			target: { effectId: effect.id }, id: effect.id, displayName: effect.displayName, description: effect.description, kind: effect.kind, tags: effect.tags,
		}))),
		'Query:getEffect': input => {
			const effectId = identifier(inputObject(input), 'effectId');
			const definitions = getEffectDefinitions(state);
			if (!Object.hasOwn(definitions, effectId)) throw new Error(`Effect not found: ${effectId}`);
			const effect = definitions[effectId];
			return snapshot({ ...effect, target: { effectId } });
		},
		'Query:listProjectAutomationGraphs': () => snapshot(state.automationGraphs.value.map(graph => ({ ...graph, target: { automationGraphId: graph.id } }))),
		'Query:getProjectAutomationGraph': input => {
			const automationGraphId = identifier(inputObject(input), 'automationGraphId');
			const graph = state.automationGraphs.value.find(candidate => candidate.id === automationGraphId);
			if (graph == null) throw new Error(`Automation Graph not found: ${automationGraphId}`);
			return snapshot({ ...graph, target: { automationGraphId } });
		},
		'Query:listCustomShaderEffects': () => state.customShaderEffects.value.map(effect => ({ target: { customShaderEffectId: effect.id }, name: effect.name, description: effect.description })),
		'Query:getCustomShaderEffect': input => {
			const customShaderEffectId = identifier(inputObject(input), 'customShaderEffectId');
			const effect = state.customShaderEffects.value.find(candidate => candidate.id === customShaderEffectId);
			if (effect == null) throw new Error(`Custom Shader Effect not found: ${customShaderEffectId}`);
			return snapshot({ ...effect, target: { customShaderEffectId } });
		},
	};
}
