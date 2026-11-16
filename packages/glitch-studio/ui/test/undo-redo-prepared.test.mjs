import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: "export { UndoRedo } from './src/utility/undo-redo.ts';" },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { UndoRedo } = loaded.exports;

function fixture() {
	let nextId = 0;
	const state = { items: [], value: 0 };
	const definitions = {
		createItem: {
			label: 'Create item',
			prepare(state, input) {
				if (typeof input.name !== 'string') throw new Error('Name must be a string');
				const item = { id: ++nextId, name: input.name };
				return {
					result: { id: item.id },
					change: {
						apply(state) { state.items.push(structuredClone(item)); },
						revert(state) { state.items = state.items.filter(current => current.id !== item.id); },
						changes: [{ kind: 'item', id: item.id }],
					},
				};
			},
		},
		setItemName: {
			label: 'Set item name',
			prepare(state, input) {
				const before = state.items.find(item => item.id === input.id)?.name;
				if (before == null) throw new Error('Item not found');
				const after = input.name;
				return {
					result: null,
					change: before === after ? null : {
						apply(state) { state.items.find(item => item.id === input.id).name = after; },
						revert(state) { state.items.find(item => item.id === input.id).name = before; },
						changes: [{ kind: 'item', id: input.id }],
					},
				};
			},
		},
		setValue: {
			label: 'Set value',
			getAutoMergeKey: () => 'value',
			prepare(state, input) {
				if (!Number.isFinite(input.value)) throw new Error('Value must be finite');
				const before = state.value;
				const after = input.value;
				return {
					result: after,
					change: before === after ? null : {
						apply(state) { state.value = after; },
						revert(state) { state.value = before; },
						changes: [{ kind: 'value', value: after }],
						undoChanges: [{ kind: 'value', value: before }],
					},
				};
			},
		},
	};
	const manager = new UndoRedo(state, definitions);
	return { state, definitions, manager, get generatedCount() { return nextId; } };
}

// 【非同期準備中に呼び出し元が終了したCommandは適用しない】
// スクリプトや編集セッションの破棄後に遅れて準備が完了しても、状態と履歴を変更しない。
test('does not apply prepared changes after the caller lifetime ends', async () => {
	let finishPreparation;
	const ready = new Promise(resolve => { finishPreparation = resolve; });
	const f = fixture();
	f.definitions.pendingCreation = { label: 'Pending creation', async prepare(state, input) {
		await ready;
		return f.definitions.createItem.prepare(state, input);
	} };
	const lifetime = new AbortController();
	const pending = f.manager.execute('pendingCreation', { name: 'Closed' }, null, lifetime.signal);
	lifetime.abort();
	finishPreparation();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(f.state.items, []);
	assert.equal(f.manager.undoStack.value.length, 0);
});

// 【入力と結果を切り離し、Redoで同じIDと内容を復元する】
// 呼び出し側による後からの書き換えが状態や履歴へ混入せず、Undo/Redoで再生成も起きないことを確認する。
test('copies command input and results and prepares creation only once', async () => {
	const f = fixture();
	const input = { name: 'Original' };
	const result = await f.manager.execute('createItem', input);
	input.name = 'Mutated input';
	result.id = 999;
	assert.deepEqual(f.state.items, [{ id: 1, name: 'Original' }]);
	f.manager.undo();
	assert.deepEqual(f.state.items, []);
	f.manager.redo();
	assert.deepEqual(f.state.items, [{ id: 1, name: 'Original' }]);
	assert.equal(f.generatedCount, 1);
});

// 【非同期の準備が終わるまで状態を変更せず、待機中の入力変更も反映しない】
// 素材情報の取得などを待つ間に呼び出し側が入力を再利用しても、開始時の要求で一回だけ適用する。
test('waits for preparation without exposing caller input or applying early', async () => {
	let release;
	const ready = new Promise(resolve => { release = resolve; });
	const f = fixture();
	f.definitions.createAfterPreparation = {
		label: 'Create after preparation',
		async prepare(state, input) {
			await ready;
			return f.definitions.createItem.prepare(state, input);
		},
	};
	const input = { name: 'Before waiting' };
	const pending = f.manager.execute('createAfterPreparation', input);
	input.name = 'After waiting';
	assert.deepEqual(f.state.items, []);
	assert.equal(f.manager.undoStack.value.length, 0);
	release();
	assert.deepEqual(await pending, { id: 1 });
	assert.deepEqual(f.state.items, [{ id: 1, name: 'Before waiting' }]);
});

// 【検証エラーと変更のない操作ではUndo/Redoを変更しない】
// 入力失敗や同値設定のたびにRedoを失うと、スクリプトからの確認・再試行が破壊的になる。
test('preserves state and redo after failed preparation and no-op commands', async () => {
	const f = fixture();
	await f.manager.execute('setValue', { value: 1 });
	f.manager.undo();
	await assert.rejects(f.manager.execute('setValue', { value: NaN }), /finite/);
	assert.equal(await f.manager.execute('setValue', { value: 0 }), 0);
	assert.equal(f.state.value, 0);
	assert.equal(f.manager.undoStack.value.length, 0);
	assert.equal(f.manager.redoStack.value.length, 1);
	f.manager.redo();
	assert.equal(f.state.value, 1);
});

// 【途中で失敗した非同期グループでも成功済み操作を一つの履歴へ確定する】
// 全体を自動取消ししない仕様を守り、生成した対象への後続編集も逆順Undo・順序どおりのRedoで復元する。
test('keeps completed operations in one group when an async callback fails', async () => {
	const f = fixture();
	await assert.rejects(f.manager.runGroup('Script', async () => {
		const item = await f.manager.execute('createItem', { name: 'Created' });
		await f.manager.execute('setItemName', { id: item.id, name: 'Edited' });
		await f.manager.execute('setValue', { value: NaN });
	}), /finite/);
	assert.deepEqual(f.state.items, [{ id: 1, name: 'Edited' }]);
	assert.equal(f.manager.undoStack.value.length, 1);
	assert.equal(f.manager.undoStack.value[0].label, 'Script');
	f.manager.undo();
	assert.deepEqual(f.state.items, []);
	f.manager.redo();
	assert.deepEqual(f.state.items, [{ id: 1, name: 'Edited' }]);
	assert.equal(f.generatedCount, 1);
});

// 【同期グループはコールバックから戻った時点で確定する】
// 常にPromise待ちへ回すと、直後の独立したUI操作まで同じグループへ混入するため、その境界を検証する。
test('finishes synchronous groups before the next independent operation', () => {
	const f = fixture();
	const value = f.manager.runGroup('Synchronous edit', () => {
		f.manager.commit('createItem', { name: 'Grouped' });
		return 42;
	});
	assert.equal(value, 42);
	f.manager.commit('createItem', { name: 'Independent' });
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo();
	assert.deepEqual(f.state.items, [{ id: 1, name: 'Grouped' }]);
});

// 【空のグループと入れ子のグループを履歴単位に従って扱う】
// 準備だけの実行でRedoを失わず、内部処理がグループを使っても外側の一回のUndoへまとめる。
test('preserves redo for empty groups and combines nested groups', async () => {
	const f = fixture();
	await f.manager.execute('setValue', { value: 1 });
	f.manager.undo();
	await f.manager.runGroup('Empty', async () => {
		await f.manager.execute('setValue', { value: 0 });
	});
	assert.equal(f.manager.redoStack.value.length, 1);
	await f.manager.runGroup('Outer', async () => {
		await f.manager.execute('createItem', { name: 'First' });
		await f.manager.runGroup('Inner', async () => {
			await f.manager.execute('createItem', { name: 'Second' });
		});
	});
	assert.equal(f.manager.undoStack.value.length, 1);
	assert.equal(f.manager.redoStack.value.length, 0);
	f.manager.undo();
	assert.deepEqual(f.state.items, []);
	f.manager.redo();
	assert.deepEqual(f.state.items.map(item => item.name), ['First', 'Second']);
});

// 【購読者の例外や通知データの変更によって履歴と他の購読者を壊さない】
// 状態反映後の描画エラーを編集失敗扱いにするとUndo不能になる。通知時には履歴の移動も完了している必要がある。
test('records history before notification and isolates failing listeners', async t => {
	const f = fixture();
	const errors = [];
	t.mock.method(console, 'error', (...args) => { errors.push(args); });
	const observed = [];
	f.manager.onChange(changes => {
		changes[0].value = 999;
		throw new Error('Renderer failed');
	});
	f.manager.onChange(changes => {
		observed.push({ changes, undo: f.manager.undoStack.value.length, redo: f.manager.redoStack.value.length });
	});
	await f.manager.execute('setValue', { value: 5 });
	f.manager.undo();
	f.manager.redo();
	assert.deepEqual(observed, [
		{ changes: [{ kind: 'value', value: 5 }], undo: 1, redo: 0 },
		{ changes: [{ kind: 'value', value: 0 }], undo: 0, redo: 1 },
		{ changes: [{ kind: 'value', value: 5 }], undo: 1, redo: 0 },
	]);
	assert.equal(errors.length, 3);
});

// 【連続編集の取消しで開始状態と既存Redoを保持する】
// プレビュー中の更新は通常の通知を行いつつ、確定するまで履歴を変更しない。生成済みの古いRedoも取消し後に利用できる。
test('cancels continuous edits without discarding existing redo', async () => {
	const f = fixture();
	await f.manager.execute('createItem', { name: 'Existing redo' });
	f.manager.undo();
	const edit = f.manager.beginEdit('setValue');
	assert.equal(edit.update({ value: 1 }), 1);
	assert.equal(edit.update({ value: 2 }), 2);
	assert.equal(f.state.value, 2);
	assert.equal(f.manager.undoStack.value.length, 0);
	edit.cancel();
	assert.equal(f.state.value, 0);
	assert.equal(f.manager.redoStack.value.length, 1);
	f.manager.redo();
	assert.equal(f.state.items[0].name, 'Existing redo');
});

// 【連続編集と自動マージでは最初の状態と最後の状態を復元する】
// 最終updateの直前状態へUndoしてしまったり、Redoで最後の差分だけ再実行する不具合を防ぐ。
test('restores the earliest before and latest after state for edits and auto-merge', async t => {
	let now = 0;
	t.mock.method(performance, 'now', () => now);
	const f = fixture();
	const edit = f.manager.beginEdit('setValue');
	edit.update({ value: 2 });
	edit.update({ value: 4 });
	edit.finish();
	f.manager.undo();
	assert.equal(f.state.value, 0);
	f.manager.redo();
	assert.equal(f.state.value, 4);
	await f.manager.execute('setValue', { value: 6 });
	now = 2000;
	await f.manager.execute('setValue', { value: 8 });
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo();
	assert.equal(f.state.value, 4);
	f.manager.redo();
	assert.equal(f.state.value, 8);
});

// 【連続編集の途中に発生した構造変更をUndo・Redo・キャンセルでも通知する】
// 最後の更新が通常の値編集でも、編集開始時の構造へ戻す側・最終構造を再適用する側の
// 両方に再構築が必要。同一通知は反復回数分を保存せず、構造変更の種類だけを保持する。
test('retains structural notifications through continuous edits and cancellation', () => {
	const state = { source: 'original', value: 0 };
	const notifications = [];
	const manager = new UndoRedo(state, { replace: {
		label: 'Replace source and value',
		prepare(state, input) {
			const before = { ...state };
			const after = { ...input };
			return { result: null, change: {
				apply: state => Object.assign(state, after),
				revert: state => Object.assign(state, before),
				changes: [{ kind: before.source === after.source ? 'value' : 'source' }],
			} };
		},
	} });
	manager.onChange(changes => notifications.push(changes));
	const edit = manager.beginEdit('replace');
	edit.update({ source: 'updated', value: 1 });
	for (let value = 2; value <= 20; value++) edit.update({ source: 'updated', value });
	edit.finish();
	manager.undo();
	assert.deepEqual(state, { source: 'original', value: 0 });
	assert.deepEqual(notifications.at(-1), [{ kind: 'value' }, { kind: 'source' }]);
	manager.redo();
	assert.deepEqual(state, { source: 'updated', value: 20 });
	assert.deepEqual(notifications.at(-1), [{ kind: 'source' }, { kind: 'value' }]);
	const cancelled = manager.beginEdit('replace');
	cancelled.update({ source: 'cancelled', value: 21 });
	cancelled.update({ source: 'cancelled', value: 22 });
	cancelled.cancel();
	assert.deepEqual(state, { source: 'updated', value: 20 });
	assert.deepEqual(notifications.at(-1), [{ kind: 'value' }, { kind: 'source' }]);
	assert.equal(manager.undoStack.value.length, 1);
});

// 【大量の変更もグループ単位で履歴上限を適用する】
// スクリプト内の操作数に上限を適用すると途中の操作がUndo不能になるため、確定したグループを一件として数える。
test('applies the history limit to groups instead of their individual operations', async () => {
	const f = fixture();
	await f.manager.runGroup('Many items', async () => {
		for (let index = 0; index < 150; index++) await f.manager.execute('createItem', { name: String(index) });
	});
	assert.equal(f.state.items.length, 150);
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.undo();
	assert.deepEqual(f.state.items, []);
	f.manager.redo();
	assert.equal(f.state.items.length, 150);
	assert.equal(f.generatedCount, 150);
});

// 【存在しないCommandと非同期Commandの同期実行を拒否する】
// プロトタイプ由来の名前を登録済みCommandと誤認せず、事前準備待ちを無視して履歴へ記録しない。
test('rejects unknown command names and asynchronous use of the synchronous path', async () => {
	const f = fixture();
	await assert.rejects(f.manager.execute('constructor', {}), /Unknown command/);
	f.definitions.asyncNoop = { label: 'Async no-op', async prepare() { return { result: null, change: null }; } };
	assert.throws(() => f.manager.commit('asyncNoop', {}), /execute/);
	assert.throws(() => f.manager.beginEdit('asyncNoop').update({}), /synchronous preparation/);
	assert.equal(f.manager.undoStack.value.length, 0);
});
