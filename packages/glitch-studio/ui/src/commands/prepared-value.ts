import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import type { Cloneable } from '@gs/shared/utility/deep-clone.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';

/**
 * 保存値の変更前後だけを保持する。呼び出し元やリアクティブな値への参照を履歴へ
 * 残さず、Redoでも検証・ID生成・既定値の再計算を行わない。
 * バイナリなどの外部資源は対象外とし、JSONとして表現できる編集値に使用する。
 */
export function prepareProjectValueChange<Value extends Cloneable, Result = void>(options: {
	before: Value;
	after: Value;
	equals?: (before: Value, after: Value) => boolean;
	write: (state: ProjectState, value: Value) => void;
	changes: AppStateChange[];
	result: Result;
}): PreparedCommand<ProjectState, AppStateChange, Result> {
	const before = deepClone(options.before);
	const after = deepClone(options.after);
	if ((options.equals ?? deepEqual)(before, after)) {
		return { result: options.result, change: null };
	}
	return {
		result: options.result,
		change: {
			changes: options.changes,
			apply: state => options.write(state, deepClone(after)),
			revert: state => options.write(state, deepClone(before)),
		},
	};
}
