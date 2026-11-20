import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { changedEffectReferences } from './effect-registration-changes.ts';
import { canPreserveTimelineLayerInstance, isCustomNodeGraphEffectValueChange } from './project-change-policy.ts';

/** 定義の変更だけを数える。描画回数やGPUリソースの世代とは独立して扱う。 */
export class ProjectStateVersions {
	private revision = 0;
	private layers = new Map<string, number>();
	private scenes = new Map<string, number>();

	public scene(id: string) { return this.scenes.get(id) ?? 0; }
	public layer(sceneId: string, layerId: string) { return this.layers.get(JSON.stringify([sceneId, layerId])) ?? 0; }

	public apply(changes: readonly RendererProjectChange[], previousState: RendererProjectState, next: RendererProjectState) {
		const revision = ++this.revision;
		const affected = changedEffectReferences(changes.filter(change => !isCustomNodeGraphEffectValueChange(change)), next);
		if (affected != null) {
			for (const scene of next.timelineScenes) {
				for (const layer of flattenTimelineLayers(scene.layers)) {
					if (layer.layerType === 'effect' && affected(layer.effectSource)) this.layers.set(JSON.stringify([scene.id, layer.id]), revision);
				}
			}
		}
		for (const change of changes) {
			if (change.type === 'layerTree') {
				// 並び・親だけの変更では既存配置の履歴を捨てない。ただし削除後に描画せず
				// Undoした場合にも、復活したIDへ削除前のインスタンスを使い回さない。
				const previousLayers = new Map(flattenTimelineLayers(previousState.timelineScenes.find(scene => scene.id === change.sceneId)?.layers ?? []).map(layer => [layer.id, layer.layerType]));
				const nextLayers = new Map(flattenTimelineLayers(change.layers).map(layer => [layer.id, layer.layerType]));
				for (const id of new Set([...previousLayers.keys(), ...nextLayers.keys()])) {
					if (previousLayers.get(id) !== nextLayers.get(id)) this.layers.set(JSON.stringify([change.sceneId, id]), revision);
				}
			} else if ((change.type === 'node' || change.type === 'customNodeGraphEffect') && 'sceneId' in change && !isCustomNodeGraphEffectValueChange(change)) {
				this.layers.set(JSON.stringify([change.sceneId, change.layerId]), revision);
			} else if (change.type === 'layer' && !canPreserveTimelineLayerInstance(change.changes)
				&& ((change.layer == null || !isTimelineContainerLayer(change.layer)) || change.changes.some(edit => edit.type === 'definition'))) {
				// コンテナ自身の設定は毎回読み直すため、子の描画履歴まで巻き込んで破棄しない。
				this.layers.set(JSON.stringify([change.sceneId, change.layerId]), revision);
			} else if (change.type === 'scene') {
				this.scenes.set(change.sceneId, revision);
			}
		}
	}
}
