import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { findTimelineLayer, updateTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ProjectCustomShaderEffect, ProjectCustomNodeGraphEffect } from './types.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectNode, CustomNodeGraphEffectNodeChange } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { TimelineClipLayer, TimelineContainerLayer, TimelineLayer, TimelineLayerChange, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { CustomNodeGraphEffectTarget } from './custom-node-graph-effect-target.ts';

export type RendererProjectState = {
	automationGraphs: AutomationGraph[];
	customNodeGraphEffects: ProjectCustomNodeGraphEffect[];
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

export type RendererProjectChange =
	// 入出力の編集で補正した配置も同時に交換し、新旧の定義・Bindingを混在させない。
	| { type: 'customShaderEffects'; customShaderEffects: ProjectCustomShaderEffect[]; project: RendererProjectState }
	| { type: 'automationGraphs'; automationGraphs: AutomationGraph[] }
	| { type: 'node'; target: CustomNodeGraphEffectTarget; node: CustomNodeGraphEffectNode; changes: CustomNodeGraphEffectNodeChange[] }
	| { type: 'customNodeGraphEffect'; target: CustomNodeGraphEffectTarget; customNodeGraphEffect: CustomNodeGraphEffect; customParameterValuesOnly?: boolean }
	| { type: 'customNodeGraphEffectRegistration'; customNodeGraphEffectId: string; customNodeGraphEffect: ProjectCustomNodeGraphEffect | null }
	| { type: 'layer'; sceneId: string; layerId: string; layer: RendererLayerState | null; changes: TimelineLayerChange[] }
	// 階層の最終状態を一度だけ送る。同時に編集した設定・ノードの変更種別は別の差分に残す。
	| { type: 'layerTree'; sceneId: string; layers: TimelineLayer[] }
	| { type: 'layerOrder'; sceneId: string; layerIds: string[] }
	| { type: 'scene'; sceneId: string; scene: TimelineScene | null };

export function findRendererCustomNodeGraphEffect(state: RendererProjectState, target: CustomNodeGraphEffectTarget): CustomNodeGraphEffect | null {
	if ('customNodeGraphEffectId' in target) return state.customNodeGraphEffects.find(customNodeGraphEffect => customNodeGraphEffect.id === target.customNodeGraphEffectId) ?? null;
	const layer = findTimelineLayer(state.timelineScenes.find(scene => scene.id === target.sceneId)?.layers ?? [], target.inlineCustomNodeGraphEffectLayerId);
	return layer?.layerType === 'inlineCustomNodeGraphEffect' ? layer.customNodeGraphEffect : null;
}

/**
 * UIの確定済みの値を反映する。IDの生成や配線修復、時刻の丸めはここでは行わない。
 * 変更した枝だけを置換し、受信済みの定義や描画中の旧定義を変更しない。
 * 途中で失敗しても呼び出し元の状態は変わらず、完成した結果を一度だけ採用できる。
 */
export function applyRendererProjectChanges(state: RendererProjectState, changes: readonly RendererProjectChange[]): RendererProjectState {
	let automationGraphs = state.automationGraphs;
	let customNodeGraphEffects = state.customNodeGraphEffects;
	let timelineScenes = state.timelineScenes;
	const updateScene = (id: string, update: (scene: TimelineScene) => TimelineScene) => {
		const index = timelineScenes.findIndex(scene => scene.id === id);
		if (index < 0) throw new Error('Scene not found: ' + id);
		const next = update(timelineScenes[index]);
		timelineScenes = timelineScenes.with(index, next);
	};
	for (const change of changes) {
		switch (change.type) {
			case 'customShaderEffects': {
				({ automationGraphs, customNodeGraphEffects, timelineScenes } = change.project);
				break;
			}
			case 'automationGraphs': automationGraphs = change.automationGraphs; break;
			case 'customNodeGraphEffectRegistration': {
				if (change.customNodeGraphEffect == null) customNodeGraphEffects = customNodeGraphEffects.filter(customNodeGraphEffect => customNodeGraphEffect.id !== change.customNodeGraphEffectId);
				else {
					if (change.customNodeGraphEffect.id !== change.customNodeGraphEffectId) throw new Error('Custom Node Graph Effect ID does not match');
					const index = customNodeGraphEffects.findIndex(customNodeGraphEffect => customNodeGraphEffect.id === change.customNodeGraphEffectId);
					customNodeGraphEffects = index < 0 ? [...customNodeGraphEffects, change.customNodeGraphEffect] : customNodeGraphEffects.with(index, change.customNodeGraphEffect);
				}
				break;
			}
			case 'node':
			case 'customNodeGraphEffect': {
				const update = (customNodeGraphEffect: CustomNodeGraphEffect): CustomNodeGraphEffect => {
					if (change.type === 'customNodeGraphEffect') return change.customNodeGraphEffect;
					const index = customNodeGraphEffect.nodes.findIndex(node => node.id === change.node.id);
					if (index < 0) throw new Error('Node not found: ' + change.node.id);
					const previous = customNodeGraphEffect.nodes[index];
					if (previous.type !== change.node.type || (previous.type === 'effect' && change.node.type === 'effect' && previous.effectId !== change.node.effectId)) {
						throw new Error('Node type cannot change');
					}
					return { ...customNodeGraphEffect, nodes: customNodeGraphEffect.nodes.with(index, change.node) };
				};
				const target = change.target;
				if ('customNodeGraphEffectId' in target) {
					const index = customNodeGraphEffects.findIndex(customNodeGraphEffect => customNodeGraphEffect.id === target.customNodeGraphEffectId);
					if (index < 0) throw new Error('Custom Node Graph Effect not found: ' + target.customNodeGraphEffectId);
					const previous = customNodeGraphEffects[index];
					customNodeGraphEffects = customNodeGraphEffects.with(index, { ...update(previous), id: previous.id, name: previous.name });
				} else {
					updateScene(target.sceneId, scene => {
						const layer = findTimelineLayer(scene.layers, target.inlineCustomNodeGraphEffectLayerId);
						if (layer?.layerType !== 'inlineCustomNodeGraphEffect') throw new Error('Inline Custom Node Graph Effect not found');
						return { ...scene, layers: updateTimelineLayer(scene.layers, layer.id, () => ({ ...layer, customNodeGraphEffect: update(layer.customNodeGraphEffect) })) };
					});
				}
				break;
			}
			case 'layer':
				updateScene(change.sceneId, scene => {
					const previous = findTimelineLayer(scene.layers, change.layerId);
					if (change.layer == null) return { ...scene, layers: updateTimelineLayer(scene.layers, change.layerId, () => null) };
					if (change.layer.id !== change.layerId) throw new Error('Layer ID does not match');
					const layer: TimelineLayer = isTimelineContainerLayer(change.layer)
						? { ...change.layer, layers: previous && isTimelineContainerLayer(previous) ? previous.layers : [] } : change.layer;
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
	return { automationGraphs, customNodeGraphEffects, timelineScenes };
}
