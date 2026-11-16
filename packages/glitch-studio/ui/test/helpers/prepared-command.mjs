// 履歴操作そのものを扱わないドメインテストでも、初回にだけ準備した差分を使う。
// Redoでprepareを呼び直すと、採番や素材の読み出しが再実行される不具合を見逃してしまう。
export function prepareTestCommand(definition, input) {
	let prepared = null;
	return {
		execute(state) {
			prepared ??= definition.prepare(state, input);
			if (prepared instanceof Promise) return prepared.then(command => {
				prepared = command;
				command.change?.apply(state);
				return command.result;
			});
			prepared.change?.apply(state);
			return prepared.result;
		},
		undo(state) {
			if (prepared == null || prepared instanceof Promise) throw new Error('Command has not finished preparation');
			prepared.change?.revert(state);
		},
	};
}
