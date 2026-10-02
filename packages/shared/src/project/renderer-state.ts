import type { ProjectVisualModule } from './types.ts';
import type { VisualModule, VisualModuleNode } from '../visual-module/types.ts';
import type { TimelineLayer, TimelineScene } from '../timeline/types.ts';

// Moduleは自身の配置先を知らない。登録・Scene内の所在はプロジェクト側で付加する。
export type VisualModuleTarget =
	| { visualModuleId: string }
	| { sceneId: string; inlineVisualModuleLayerId: string };

export type RendererProjectState = {
	visualModules: ProjectVisualModule[];
	timelineScenes: TimelineScene[];
};

export type RendererProjectChange =
	| { type: 'node'; target: VisualModuleTarget; node: VisualModuleNode; preserveCache: boolean }
	| { type: 'visualModule'; target: VisualModuleTarget; visualModule: VisualModule }
	| { type: 'layer'; sceneId: string; layerId: string; layer: TimelineLayer | null; preserveModuleInstance: boolean }
	| { type: 'layerOrder'; sceneId: string; layerIds: string[] }
	| { type: 'scene'; sceneId: string; scene: TimelineScene | null };

export function visualModuleTargetKey(target: VisualModuleTarget): string {
	return 'visualModuleId' in target ? JSON.stringify(['module', target.visualModuleId])
		: JSON.stringify(['inline', target.sceneId, target.inlineVisualModuleLayerId]);
}

export function findRendererVisualModule(state: RendererProjectState, target: VisualModuleTarget): VisualModule | undefined {
	if ('visualModuleId' in target) return state.visualModules.find(module => module.id === target.visualModuleId);
	const layer = state.timelineScenes.find(scene => scene.id === target.sceneId)?.layers.find(layer => layer.id === target.inlineVisualModuleLayerId);
	return layer?.layerType === 'inlineVisualModule' ? layer.visualModule : undefined;
}

/**
 * UIの確定済みの値を反映する。IDの生成や配線修復、時刻の丸めはここでは行わない。
 * 変更した枝だけを置換し、受信済みの定義や描画中の旧定義を変更しない。
 * 途中で失敗しても呼び出し元の状態は変わらず、完成した結果を一度だけ採用できる。
 */
export function applyRendererProjectChanges(state: RendererProjectState, changes: readonly RendererProjectChange[]): RendererProjectState {
	let visualModules = state.visualModules;
	let timelineScenes = state.timelineScenes;
	const updateScene = (id: string, update: (scene: TimelineScene) => TimelineScene) => {
		const index = timelineScenes.findIndex(scene => scene.id === id);
		if (index < 0) throw new Error('Scene not found: ' + id);
		const next = update(timelineScenes[index]);
		timelineScenes = timelineScenes.with(index, next);
	};
	for (const change of changes) {
		switch (change.type) {
			case 'node':
			case 'visualModule': {
				const update = (module: VisualModule): VisualModule => {
					if (change.type === 'visualModule') return change.visualModule;
					const index = module.nodes.findIndex(node => node.id === change.node.id);
					if (index < 0) throw new Error('Node not found: ' + change.node.id);
					const previous = module.nodes[index];
					if (previous.type !== change.node.type || (previous.type === 'effect' && change.node.type === 'effect' && previous.effectId !== change.node.effectId)) {
						throw new Error('Node type cannot change');
					}
					return { ...module, nodes: module.nodes.with(index, change.node) };
				};
				const target = change.target;
				if ('visualModuleId' in target) {
					const index = visualModules.findIndex(module => module.id === target.visualModuleId);
					if (index < 0) throw new Error('Visual module not found: ' + target.visualModuleId);
					const previous = visualModules[index];
					visualModules = visualModules.with(index, { ...update(previous), id: previous.id, name: previous.name });
				} else {
					updateScene(target.sceneId, scene => {
						const index = scene.layers.findIndex(layer => layer.id === target.inlineVisualModuleLayerId);
						const layer = scene.layers[index];
						if (layer?.layerType !== 'inlineVisualModule') throw new Error('Inline visual module not found');
						return { ...scene, layers: scene.layers.with(index, { ...layer, visualModule: update(layer.visualModule) }) };
					});
				}
				break;
			}
			case 'layer':
				updateScene(change.sceneId, scene => {
					const index = scene.layers.findIndex(layer => layer.id === change.layerId);
					if (change.layer == null) return { ...scene, layers: scene.layers.filter(layer => layer.id !== change.layerId) };
					if (change.layer.id !== change.layerId) throw new Error('Layer ID does not match');
					return { ...scene, layers: index < 0 ? [...scene.layers, change.layer] : scene.layers.with(index, change.layer) };
				});
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
	return { visualModules, timelineScenes };
}
