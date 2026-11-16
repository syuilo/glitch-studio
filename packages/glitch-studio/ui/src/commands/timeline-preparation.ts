import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { findTimelineLayer, updateTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import type { TimelineScene, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { CommandDef } from './definition.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';

export type TimelineEditScope = { sceneId: string; layerIds?: readonly string[] } | { scenes: true };

function replaceProperties<T extends TimelineScene | TimelineLayer>(target: T, value: T): void {
	// Scene・Layer・ClipへのUI参照は保ち、変更対象のプロパティだけを交換する。
	// 保存スナップショットをそのまま共有すると次の編集で履歴まで変化するため、必ず値を複製する。
	const reconcile = (current: unknown, next: unknown): unknown => {
		if (Array.isArray(next)) {
			const previous = Array.isArray(current) ? current : [];
			return next.map((item, index) => {
				const existing = item != null && typeof item === 'object' && 'id' in item
					? previous.find(value => value != null && typeof value === 'object' && value.id === item.id) : previous[index];
				return reconcile(existing, item);
			});
		}
		if (next != null && typeof next === 'object') {
			const result = current != null && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
			for (const key of Object.keys(result)) if (!Object.hasOwn(next, key)) delete result[key];
			for (const [key, value] of Object.entries(next)) result[key] = reconcile(result[key], value);
			return result;
		}
		return next;
	};
	for (const key of Object.keys(target)) {
		if (!Object.hasOwn(value, key)) delete (target as Record<string, unknown>)[key];
	}
	for (const [key, next] of Object.entries(value)) (target as Record<string, unknown>)[key] = reconcile((target as Record<string, unknown>)[key], next);
}

/**
 * Commandの計算は切り離した編集対象で完了させ、適用時には検証済みの値だけを交換する。
 * パラメータ・クリップの連続編集では対象Layerだけを複製し、Scene全体や素材を毎回コピーしない。
 * 階層操作だけは所属Sceneを一つの整合性の単位として扱う。
 */
export function prepareTimelineEdit<Result>(
	state: ProjectState,
	scope: TimelineEditScope,
	edit: (draft: ProjectState) => Result,
	changes: (draft: ProjectState) => AppStateChange[],
): PreparedCommand<ProjectState, AppStateChange, Result> {
	const originalScenes = state.timelineScenes.value;
	let draftScenes: TimelineScene[];
	let before: TimelineScene[] | TimelineScene | TimelineLayer[];
	let readAfter: () => typeof before;
	let restore: (state: ProjectState, snapshot: typeof before) => void;
	if ('scenes' in scope) {
		// Sceneの登録・削除は既存Sceneの内容を編集しないため、一覧だけを分離する。
		before = [...originalScenes];
		draftScenes = [...originalScenes];
		readAfter = () => {
			const after = draft.timelineScenes.value;
			const retainedIds = new Set(originalScenes.filter(scene => after.includes(scene)).map(scene => scene.id));
			// 一覧に残るSceneの内容は変更しない。追加・削除されたSceneだけを履歴へ複製する。
			before = originalScenes.map(scene => retainedIds.has(scene.id) ? scene : deepClone(scene));
			return after.map(scene => retainedIds.has(scene.id) ? scene : deepClone(scene));
		};
		restore = (current, snapshot) => { current.timelineScenes.value = (snapshot as TimelineScene[]).map(scene => current.timelineScenes.value.find(value => value.id === scene.id) ?? deepClone(scene)); };
	} else {
		const originalScene = getTimelineScene(originalScenes, scope.sceneId);
		if (scope.layerIds != null) {
			const layerIds = [...new Set(scope.layerIds)];
			const getLayers = (scene: TimelineScene) => layerIds.map(layerId => {
				const layer = findTimelineLayer(scene.layers, layerId);
				if (layer == null) throw new Error(`Timeline layer not found: ${layerId}`);
				return layer;
			});
			before = deepClone(getLayers(originalScene));
			let layers = originalScene.layers;
			for (const layer of before) layers = updateTimelineLayer(layers, layer.id, () => deepClone(layer));
			const draftScene = { ...originalScene, layers };
			draftScenes = originalScenes.map(scene => scene.id === scope.sceneId ? draftScene : scene);
			readAfter = () => deepClone(getLayers(getTimelineScene(draft.timelineScenes.value, scope.sceneId)));
			restore = (current, snapshot) => {
				const scene = getTimelineScene(current.timelineScenes.value, scope.sceneId);
				for (const next of snapshot as TimelineLayer[]) {
					const layer = findTimelineLayer(scene.layers, next.id);
					if (layer == null) throw new Error(`Timeline layer not found: ${next.id}`);
					replaceProperties(layer, next);
				}
			};
		} else {
			before = deepClone(originalScene);
			const draftScene = deepClone(originalScene);
			draftScenes = originalScenes.map(scene => scene.id === scope.sceneId ? draftScene : scene);
			readAfter = () => deepClone(getTimelineScene(draft.timelineScenes.value, scope.sceneId));
			restore = (current, snapshot) => replaceProperties(getTimelineScene(current.timelineScenes.value, scope.sceneId), snapshot as TimelineScene);
		}
	}
	const draft = { ...state, timelineScenes: { value: draftScenes } } as ProjectState;
	const result = edit(draft);
	const after = readAfter();
	if (deepEqual(before, after)) return { result, change: null };
	const notifications = changes(draft);
	return {
		result,
		change: {
			apply: current => restore(current, after),
			revert: current => restore(current, before),
			changes: notifications,
		},
	};
}

export function defineTimelineCommand<Input, Result = void>(definition: {
	label: string;
	getAutoMergeKey?: (input: Input) => string | null;
	scope: (input: Input) => TimelineEditScope;
	edit: (state: ProjectState, input: Input) => Result;
	changes: (state: ProjectState, input: Input) => AppStateChange[];
}): CommandDef<Input, Result> {
	return {
		label: definition.label,
		getAutoMergeKey: definition.getAutoMergeKey,
		prepare: (state, input) => prepareTimelineEdit(state, definition.scope(input), draft => definition.edit(draft, input), draft => definition.changes(draft, input)),
	};
}
