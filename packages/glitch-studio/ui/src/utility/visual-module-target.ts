import type { VisualModule } from '@gs/shared/visual-module/types.ts';
import type { AppState } from '@/types.ts';
import type { VisualModuleTarget } from '@gs/shared/project/visual-module-target.ts';

// 編集対象の所在はプロジェクトが管理し、Visual Moduleの定義には持ち込まない。
export type { VisualModuleTarget } from '@gs/shared/project/visual-module-target.ts';

export function findVisualModule(state: AppState, target: VisualModuleTarget): VisualModule | null {
	if ('visualModuleId' in target) {
		return state.visualModules.value.find(module => module.id === target.visualModuleId) ?? null;
	}
	const layer = state.timelineScenes.value.find(scene => scene.id === target.sceneId)?.layers.find(layer => layer.id === target.inlineVisualModuleLayerId);
	return layer?.layerType === 'inlineVisualModule' ? layer.visualModule : null;
}

export function getVisualModule(state: AppState, target: VisualModuleTarget): VisualModule {
	const module = findVisualModule(state, target);
	if (module == null) throw new Error('Visual module not found');
	return module;
}

export function listVisualModules(state: AppState): { target: VisualModuleTarget; visualModule: VisualModule }[] {
	return [
		...state.visualModules.value.map(visualModule => ({ target: { visualModuleId: visualModule.id }, visualModule })),
		...state.timelineScenes.value.flatMap(scene => scene.layers.flatMap(layer => layer.layerType === 'inlineVisualModule'
			? [{ target: { sceneId: scene.id, inlineVisualModuleLayerId: layer.id }, visualModule: layer.visualModule }] : [])),
	];
}
