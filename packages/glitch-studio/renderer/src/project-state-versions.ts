import { visualModuleTargetKey } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { canPreserveModuleLayerInstance, canPreserveNodeOutputCache } from './project-change-policy.ts';

/** 定義の変更だけを数える。描画回数やGPUリソースの世代とは独立して扱う。 */
export class ProjectStateVersions {
	private revision = 0;
	private modules = new Map<string, { revision: number; cacheResetRevision: number }>();
	private layers = new Map<string, number>();
	private scenes = new Map<string, number>();

	module(target: VisualModuleTarget) {
		return this.modules.get(visualModuleTargetKey(target)) ?? { revision: 0, cacheResetRevision: 0 };
	}

	scene(id: string) { return this.scenes.get(id) ?? 0; }
	layer(sceneId: string, layerId: string) { return this.layers.get(JSON.stringify([sceneId, layerId])) ?? 0; }

	apply(changes: readonly RendererProjectChange[], previousState: RendererProjectState) {
		const revision = ++this.revision;
		for (const change of changes) {
			if (change.type === 'visualModuleRegistration') {
				this.modules.set(visualModuleTargetKey({ visualModuleId: change.visualModuleId }), { revision, cacheResetRevision: revision });
			} else if (change.type === 'node' || change.type === 'visualModule') {
				const previous = this.module(change.target);
				this.modules.set(visualModuleTargetKey(change.target), { revision,
					cacheResetRevision: change.type === 'node' && canPreserveNodeOutputCache(change.changes) ? previous.cacheResetRevision : revision });
			} else if (change.type === 'layerTree') {
				// 並び・親だけの変更では既存配置の履歴を捨てない。ただし削除後に描画せず
				// Undoした場合にも、復活したIDへ削除前のインスタンスを使い回さない。
				const previousLayers = new Map(flattenTimelineLayers(previousState.timelineScenes.find(scene => scene.id === change.sceneId)?.layers ?? []).map(layer => [layer.id, layer.layerType]));
				const nextLayers = new Map(flattenTimelineLayers(change.layers).map(layer => [layer.id, layer.layerType]));
				for (const id of new Set([...previousLayers.keys(), ...nextLayers.keys()])) {
					if (previousLayers.get(id) !== nextLayers.get(id)) this.layers.set(JSON.stringify([change.sceneId, id]), revision);
				}
			} else if (change.type === 'layer' && !canPreserveModuleLayerInstance(change.changes)
				&& (change.layer?.layerType !== 'group' || change.changes.some(edit => edit.type === 'definition'))) {
				// グループ自身の設定は毎回読み直すため、子の描画履歴まで巻き込んで破棄しない。
				this.layers.set(JSON.stringify([change.sceneId, change.layerId]), revision);
			} else if (change.type === 'scene') {
				this.scenes.set(change.sceneId, revision);
			}
		}
	}
}
