import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Cloneable } from '@gs/shared/utility/deep-clone.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { getVisualModule } from '../utility/visual-module-target.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { VisualModule, VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';

export type VisualModuleNodeReference = { visualModule: VisualModuleTarget; nodeId: string };

export function getVisualModuleEffectNode(state: ProjectState, target: VisualModuleNodeReference): VisualModuleEffectNode {
	const node = getVisualModule(state, target.visualModule).nodes.find(candidate => candidate.id === target.nodeId);
	if (node?.type !== 'effect') throw new Error('Visual Module effect node not found');
	return node;
}

/**
 * 保存するのは変更される値だけ。パラメータの連続入力でVisual Module全体を複製せず、
 * Undo/Redo時にはIDから対象を引き直して、古いリアクティブなオブジェクトを保持しない。
 */
export function prepareVisualModuleValue<Value extends Cloneable, Result = void>(
	before: Value,
	after: Value,
	write: (state: ProjectState, value: Value) => void,
	changes: AppStateChange[],
	result: Result = undefined as Result,
): PreparedCommand<ProjectState, AppStateChange, Result> {
	return prepareProjectValueChange({ before, after, write, changes, result });
}

/** 複数の定義・接続を同時に変更する操作は、影響するフィールドだけを作業用に複製する。 */
export function prepareVisualModuleFields<Key extends keyof VisualModule, Result = void>(
	state: ProjectState,
	target: VisualModuleTarget,
	keys: readonly Key[],
	edit: (draft: VisualModule) => Result,
	changes: AppStateChange[] = [{ type: 'visualModule', target }],
): PreparedCommand<ProjectState, AppStateChange, Result> {
	const visualModule = getVisualModule(state, target);
	const before = Object.fromEntries(keys.map(key => [key, deepClone(visualModule[key])])) as Pick<VisualModule, Key>;
	const draft = { ...visualModule, ...deepClone(before) };
	const result = edit(draft);
	const after = Object.fromEntries(keys.map(key => [key, draft[key]])) as Pick<VisualModule, Key>;
	return prepareVisualModuleValue(before, after, (currentState, values) => {
		const current = getVisualModule(currentState, target);
		for (const key of keys) {
			// 未設定のoptional値はUndoでも未設定へ戻す。ここだけは保存形式の有無を区別する。
			if (values[key] === undefined) delete current[key];
			else current[key] = values[key];
		}
	}, changes, result);
}
