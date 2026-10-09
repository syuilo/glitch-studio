import { flattenTimelineLayers, findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectState } from '../Project.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';

// 編集対象の所在はプロジェクトが管理し、Visual Moduleの定義には持ち込まない。
export type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';

export function findVisualModule(state: ProjectState, target: VisualModuleTarget): VisualModule | null {
	if ('visualModuleId' in target) {
		return state.visualModules.value.find(module => module.id === target.visualModuleId) ?? null;
	}
	const layer = findTimelineLayer(state.timelineScenes.value.find(scene => scene.id === target.sceneId)?.layers ?? [], target.inlineVisualModuleLayerId);
	return layer?.layerType === 'inlineVisualModule' ? layer.visualModule : null;
}

export function getVisualModule(state: ProjectState, target: VisualModuleTarget): VisualModule {
	const module = findVisualModule(state, target);
	if (module == null) throw new Error('Visual module not found');
	return module;
}

export function listVisualModules(state: ProjectState): { target: VisualModuleTarget; visualModule: VisualModule }[] {
	return [
		...state.visualModules.value.map(visualModule => ({ target: { visualModuleId: visualModule.id }, visualModule })),
		...state.timelineScenes.value.flatMap(scene => flattenTimelineLayers(scene.layers).flatMap(layer => layer.layerType === 'inlineVisualModule'
			? [{ target: { sceneId: scene.id, inlineVisualModuleLayerId: layer.id }, visualModule: layer.visualModule }] : [])),
	];
}
