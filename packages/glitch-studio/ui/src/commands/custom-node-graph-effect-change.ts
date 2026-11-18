import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Cloneable } from '@gs/shared/utility/deep-clone.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { getCustomNodeGraphEffect } from '../utility/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';

export type CustomNodeGraphEffectNodeReference = { customNodeGraphEffect: CustomNodeGraphEffectTarget; nodeId: string };

export function getCustomNodeGraphEffectEffectNode(state: ProjectState, target: CustomNodeGraphEffectNodeReference): CustomNodeGraphEffectEffectNode {
	const node = getCustomNodeGraphEffect(state, target.customNodeGraphEffect).nodes.find(candidate => candidate.id === target.nodeId);
	if (node?.type !== 'effect') throw new Error('Effect node not found in Custom Node Graph Effect');
	return node;
}

/**
 * 保存するのは変更される値だけ。パラメータの連続入力でCustom Node Graph Effect全体を複製せず、
 * Undo/Redo時にはIDから対象を引き直して、古いリアクティブなオブジェクトを保持しない。
 */
export function prepareCustomNodeGraphEffectValue<Value extends Cloneable, Result = void>(
	before: Value,
	after: Value,
	write: (state: ProjectState, value: Value) => void,
	changes: AppStateChange[],
	result: Result = undefined as Result,
): PreparedCommand<ProjectState, AppStateChange, Result> {
	return prepareProjectValueChange({ before, after, write, changes, result });
}

/** 複数の定義・接続を同時に変更する操作は、影響するフィールドだけを作業用に複製する。 */
export function prepareCustomNodeGraphEffectFields<Key extends keyof CustomNodeGraphEffect, Result = void>(
	state: ProjectState,
	target: CustomNodeGraphEffectTarget,
	keys: readonly Key[],
	edit: (draft: CustomNodeGraphEffect) => Result,
	changes: AppStateChange[] = [{ type: 'customNodeGraphEffect', target }],
): PreparedCommand<ProjectState, AppStateChange, Result> {
	const customNodeGraphEffect = getCustomNodeGraphEffect(state, target);
	const before = Object.fromEntries(keys.map(key => [key, deepClone(customNodeGraphEffect[key])])) as Pick<CustomNodeGraphEffect, Key>;
	const draft = { ...customNodeGraphEffect, ...deepClone(before) };
	const result = edit(draft);
	const after = Object.fromEntries(keys.map(key => [key, draft[key]])) as Pick<CustomNodeGraphEffect, Key>;
	return prepareCustomNodeGraphEffectValue(before, after, (currentState, values) => {
		const current = getCustomNodeGraphEffect(currentState, target);
		for (const key of keys) {
			// 未設定のoptional値はUndoでも未設定へ戻す。ここだけは保存形式の有無を区別する。
			if (values[key] === undefined) delete current[key];
			else current[key] = values[key];
		}
	}, changes, result);
}
