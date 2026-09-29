import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { AppState } from '@/types.ts';

// 編集対象の所在はUIが管理し、Visual Moduleの定義には持ち込まない。
export type VisualModuleTarget =
	| { visualModuleId: string }
	| { inlineVisualModuleLayerId: string };

export function findVisualModule(state: AppState, target: VisualModuleTarget): VisualModule | null {
	if ('visualModuleId' in target) {
		return state.visualModules.value.find(module => module.id === target.visualModuleId) ?? null;
	}
	const layer = state.timeline.value.find(layer => layer.id === target.inlineVisualModuleLayerId);
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
		...state.timeline.value.flatMap(layer => layer.layerType === 'inlineVisualModule'
			? [{ target: { inlineVisualModuleLayerId: layer.id }, visualModule: layer.visualModule }] : []),
	];
}
