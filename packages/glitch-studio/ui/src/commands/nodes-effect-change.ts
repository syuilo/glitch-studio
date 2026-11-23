import { acceptsResolutionInput } from '@gs/subsystems_effect_shared/validate-effect-source.ts';
import { editNodesEffectView } from '../utility/nodes-effect-view.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Cloneable } from '@gs/shared/utility/deep-clone.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { getNodesEffect, findNodesEffectOwner } from '../utility/nodes-effect-target.ts';
import type { NodesEffectTarget } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';
import type { NodesEffect, NodesEffectEffectNode } from '@/types/nodes-effect-view.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';

export type NodesEffectNodeReference = { nodesEffect: NodesEffectTarget; nodeId: string };

export function getNodesEffectEffectNode(state: ProjectState, target: NodesEffectNodeReference): NodesEffectEffectNode {
	const node = getNodesEffect(state, target.nodesEffect).nodes.find(candidate => candidate.id === target.nodeId);
	if (node?.type !== 'effect') throw new Error('Effect node not found in Nodes Effect');
	return node;
}

/**
 * 保存するのは変更される値だけ。パラメータの連続入力でNodes Effect全体を複製せず、
 * Undo/Redo時にはIDから対象を引き直して、古いリアクティブなオブジェクトを保持しない。
 */
export function prepareNodesEffectValue<Value extends Cloneable, Result = void>(
	before: Value,
	after: Value,
	write: (state: ProjectState, value: Value) => void,
	changes: AppStateChange[],
	result: Result = undefined as Result,
): PreparedCommand<ProjectState, AppStateChange, Result> {
	const edit = changes.find(change => change.type === 'nodesEffect' || change.type === 'node' || change.type === 'nodeName');
	return prepareProjectValueChange({ before, after, changes, result, write(state, value) {
		if (edit == null) { write(state, value); return; }
		const owner = findNodesEffectOwner(state, edit.target);
		if (owner == null) throw new Error('Nodes Effect not found');
		editNodesEffectView(owner, state, () => write(state, value), edit.type === 'nodesEffect' ? undefined : edit.nodeId, edit.type === 'nodeName');
	} });
}

/** 複数の定義・接続を同時に変更する操作は、影響するフィールドだけを作業用に複製する。 */
export function prepareNodesEffectFields<Key extends keyof NodesEffect, Result = void>(
	state: ProjectState,
	target: NodesEffectTarget,
	keys: readonly Key[],
	edit: (draft: NodesEffect) => Result,
	changes: AppStateChange[] = [{ type: 'nodesEffect', target }],
): PreparedCommand<ProjectState, AppStateChange, Result> {
	const nodesEffect = getNodesEffect(state, target);
	const before = Object.fromEntries(keys.map(key => [key, deepClone(nodesEffect[key])])) as Pick<NodesEffect, Key>;
	const draft = { ...nodesEffect, ...deepClone(before) };
	const result = edit(draft);
	if (keys.some(key => key === 'resolutionInputParameters')) {
		// Auto解像度の候補は主入力と独立している。公開入力の編集で使えなくなった候補だけを除く。
		const parameters = new Map(draft.paramDefs.map(def => [def.id, def]));
		draft.resolutionInputParameters = draft.resolutionInputParameters.filter(id => acceptsResolutionInput(parameters.get(id)));
	}
	const after = Object.fromEntries(keys.map(key => [key, draft[key]])) as Pick<NodesEffect, Key>;
	return prepareNodesEffectValue(before, after, (currentState, values) => {
		const current = getNodesEffect(currentState, target);
		for (const key of keys) {
			// 未設定のoptional値はUndoでも未設定へ戻す。ここだけは保存形式の有無を区別する。
			if (values[key] === undefined) delete current[key];
			else current[key] = values[key];
		}
	}, changes, result);
}
