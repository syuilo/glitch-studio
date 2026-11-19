import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { findTimelineLayer, updateTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ProjectCustomShaderEffect, ProjectCustomNodeGraphEffect, ProjectEffectRegistrations } from './types.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectNode } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import type { ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineClipLayer, TimelineContainerLayer, TimelineLayer, TimelineLayerChange, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { CustomNodeGraphEffectTarget } from './custom-node-graph-effect-target.ts';

export type RendererProjectState = ProjectEffectRegistrations & {
	automationGraphs: AutomationGraph[];
	timelineScenes: TimelineScene[];
};

// 通信上の設定差分は子の配置を所有しない。保存形式の木はTimelineに残し、
// Glitch Studioの同期契約でだけ設定と階層を分ける。
type RendererContainerState = { [Type in TimelineContainerLayer['layerType']]: Omit<Extract<TimelineContainerLayer, { layerType: Type }>, 'layers'> & { layers?: never } }[TimelineContainerLayer['layerType']];
export type RendererLayerState = TimelineClipLayer | RendererContainerState;

export function getRendererLayerState(layer: TimelineLayer): RendererLayerState {
	if (!isTimelineContainerLayer(layer)) return layer;
	const { layers, ...settings } = layer;
	return settings;
}

export type CustomNodeGraphEffectNodeChange =
	| { type: 'parameter'; kind: ParameterChangeKind }
	| { type: 'effectSource' | 'bypass' | 'resolution' | 'staticSetting' };

// 定義と利用側の補正を同じ差分列で適用する。インライン編集は定義を所有するノード・Graphまたはレイヤーの置換で伝える。
export type RendererProjectChange =
	| { type: 'automationGraphs'; automationGraphs: AutomationGraph[] }
	| { type: 'node'; customNodeGraphEffectId: string; node: CustomNodeGraphEffectNode; changes: CustomNodeGraphEffectNodeChange[] }
	| { type: 'customNodeGraphEffect'; customNodeGraphEffectId: string; customNodeGraphEffect: CustomNodeGraphEffect; customParameterValuesOnly?: boolean }
	| { type: 'customNodeGraphEffectRegistration'; customNodeGraphEffectId: string; customNodeGraphEffect: ProjectCustomNodeGraphEffect | null }
	| { type: 'customShaderEffectRegistration'; customShaderEffectId: string; customShaderEffect: ProjectCustomShaderEffect | null }
	| { type: 'layer'; sceneId: string; layerId: string; layer: RendererLayerState | null; changes: TimelineLayerChange[] }
	// 階層の最終状態を一度だけ送る。同時に編集した設定・ノードの変更種別は別の差分に残す。
	| { type: 'layerTree'; sceneId: string; layers: TimelineLayer[] }
	| { type: 'layerOrder'; sceneId: string; layerIds: string[] }
	| { type: 'scene'; sceneId: string; scene: TimelineScene | null };

export function findRendererCustomNodeGraphEffect(state: RendererProjectState, target: CustomNodeGraphEffectTarget): CustomNodeGraphEffect | null {
	if ('customNodeGraphEffectId' in target) return state.customNodeGraphEffects.find(customNodeGraphEffect => customNodeGraphEffect.id === target.customNodeGraphEffectId)?.definition ?? null;
	const layer = findTimelineLayer(state.timelineScenes.find(scene => scene.id === target.sceneId)?.layers ?? [], target.layerId);
	return layer?.layerType === 'effect' && layer.effectSource.type === 'inlineCustomNodeGraphEffect' ? layer.effectSource.customNodeGraphEffect : null;
}

function updateRegistration<T extends { id: string }>(entries: T[], id: string, entry: T | null): T[] {
	if (entry == null) return entries.filter(previous => previous.id !== id);
	if (entry.id !== id) throw new Error('Effect registration ID does not match: ' + id);
	const index = entries.findIndex(previous => previous.id === id);
	return index < 0 ? [...entries, entry] : entries.with(index, entry);
}

/**
 * UIの確定済みの値を反映する。IDの生成や配線修復、時刻の丸めはここでは行わない。
 * 変更した枝だけを置換し、受信済みの定義や描画中の旧定義を変更しない。
 * 途中で失敗しても呼び出し元の状態は変わらず、完成した結果を一度だけ採用できる。
 */
export function applyRendererProjectChanges(state: RendererProjectState, changes: readonly RendererProjectChange[]): RendererProjectState {
	let automationGraphs = state.automationGraphs;
	let customNodeGraphEffects = state.customNodeGraphEffects;
	let customShaderEffects = state.customShaderEffects;
	let timelineScenes = state.timelineScenes;
	const updateScene = (id: string, update: (scene: TimelineScene) => TimelineScene) => {
		const index = timelineScenes.findIndex(scene => scene.id === id);
		if (index < 0) throw new Error('Scene not found: ' + id);
		const next = update(timelineScenes[index]);
		timelineScenes = timelineScenes.with(index, next);
	};
	for (const change of changes) {
		switch (change.type) {
			case 'automationGraphs': automationGraphs = change.automationGraphs; break;
			case 'customShaderEffectRegistration':
				customShaderEffects = updateRegistration(customShaderEffects, change.customShaderEffectId, change.customShaderEffect);
				break;
			case 'customNodeGraphEffectRegistration':
				customNodeGraphEffects = updateRegistration(customNodeGraphEffects, change.customNodeGraphEffectId, change.customNodeGraphEffect);
				break;
			case 'node':
			case 'customNodeGraphEffect': {
				const index = customNodeGraphEffects.findIndex(entry => entry.id === change.customNodeGraphEffectId);
				if (index < 0) throw new Error('Custom Node Graph Effect not found: ' + change.customNodeGraphEffectId);
				const previous = customNodeGraphEffects[index];
				let definition: CustomNodeGraphEffect;
				if (change.type === 'node') {
					const nodes = previous.definition.nodes;
					const nodeIndex = nodes.findIndex(node => node.id === change.node.id);
					if (nodeIndex < 0) throw new Error('Node not found: ' + change.node.id);
					definition = { ...previous.definition, nodes: nodes.with(nodeIndex, change.node) };
				} else {
					definition = change.customNodeGraphEffect;
				}
				customNodeGraphEffects = customNodeGraphEffects.with(index, { ...previous, definition });
				break;
			}
			case 'layer':
				updateScene(change.sceneId, scene => {
					const previous = findTimelineLayer(scene.layers, change.layerId);
					if (change.layer == null) return { ...scene, layers: updateTimelineLayer(scene.layers, change.layerId, () => null) };
					if (change.layer.id !== change.layerId) throw new Error('Layer ID does not match');
					const layer: TimelineLayer = isTimelineContainerLayer(change.layer)
						? { ...change.layer, layers: previous != null && isTimelineContainerLayer(previous) ? previous.layers : [] } : change.layer;
					return { ...scene, layers: previous == null ? [...scene.layers, layer] : updateTimelineLayer(scene.layers, change.layerId, () => layer) };
				});
				break;
			case 'layerTree':
				updateScene(change.sceneId, scene => ({ ...scene, layers: change.layers }));
				break;
			case 'layerOrder':
				updateScene(change.sceneId, scene => {
					const layers = new Map(scene.layers.map(layer => [layer.id, layer]));
					if (change.layerIds.length !== layers.size || new Set(change.layerIds).size !== layers.size || change.layerIds.some(id => !layers.has(id))) {
						throw new Error('Invalid layer order');
					}
					return { ...scene, layers: change.layerIds.map(id => layers.get(id)!) };
				});
				break;
			case 'scene': {
				if (change.scene == null) timelineScenes = timelineScenes.filter(scene => scene.id !== change.sceneId);
				else {
					if (change.scene.id !== change.sceneId) throw new Error('Scene ID does not match');
					const index = timelineScenes.findIndex(scene => scene.id === change.sceneId);
					timelineScenes = index < 0 ? [...timelineScenes, change.scene] : timelineScenes.with(index, change.scene);
				}
				break;
			}
		}
	}
	return { automationGraphs, customShaderEffects, customNodeGraphEffects, timelineScenes };
}
