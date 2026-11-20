import { acceptsResolutionInput } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { editCustomNodeGraphEffectView } from '../utility/custom-node-graph-effect-view.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Cloneable } from '@gs/shared/utility/deep-clone.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { getCustomNodeGraphEffect, findCustomNodeGraphEffectOwner } from '../utility/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode } from '@/types/custom-node-graph-effect-view.ts';
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
	const edit = changes.find(change => change.type === 'customNodeGraphEffect' || change.type === 'node' || change.type === 'nodeName');
	return prepareProjectValueChange({ before, after, changes, result, write(state, value) {
		if (edit == null) { write(state, value); return; }
		const owner = findCustomNodeGraphEffectOwner(state, edit.target);
		if (owner == null) throw new Error('Custom Node Graph Effect not found');
		editCustomNodeGraphEffectView(owner, state, () => write(state, value), edit.type === 'customNodeGraphEffect' ? undefined : edit.nodeId, edit.type === 'nodeName');
	} });
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
	if (keys.some(key => key === 'resolutionInputParameters')) {
		// Auto解像度の候補は主入力と独立している。公開入力の編集で使えなくなった候補だけを除く。
		const parameters = new Map(draft.paramDefs.map(def => [def.id, def]));
		draft.resolutionInputParameters = draft.resolutionInputParameters.filter(id => acceptsResolutionInput(parameters.get(id)));
	}
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
