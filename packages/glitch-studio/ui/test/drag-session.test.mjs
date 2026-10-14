import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { nextTick } from 'vue';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/utility/drag-and-drop.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { startDragSession, getActiveDragData, getDragSessionData, completeDragSession, finishDragSession } = module.exports;

class DragWindow extends EventTarget {
	listeners = new Map();
	addEventListener(type, listener, options) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
		super.addEventListener(type, listener, options);
	}
	removeEventListener(type, listener, options) {
		super.removeEventListener(type, listener, options);
		this.listeners.get(type)?.delete(listener);
		if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
	}
}

function fixture(t) {
	const windowTarget = new DragWindow();
	const source = { ownerDocument: { defaultView: windowTarget } };
	const values = new Map();
	let readable = false;
	const transfer = { get types() { return [...values.keys()]; }, setData: (type, value) => values.set(type, value),
		getData(type) { assert.equal(readable, true, 'Protected drag events must not read native data'); return values.get(type) ?? ''; } };
	const event = (type, sourceTarget = source) => {
		const value = new Event(type, { cancelable: true });
		value.dataTransfer = transfer;
		Object.defineProperty(value, 'currentTarget', { value: sourceTarget });
		return value;
	};
	t.after(() => { finishDragSession('source'); finishDragSession('replacement'); });
	return { windowTarget, source, transfer, values, event, read: () => { readable = true; } };
}

const settle = async () => { await new Promise(resolve => setTimeout(resolve, 20)); await nextTick(); };

// 【protectedモードでも開始時のスナップショットを読み、DOM用の公開だけを遅らせる】
// dragoverのgetData制約を破ることなく、開始後のオブジェクト変更や外部ドラッグの混入を防ぐ。
// Chromeでdragstart中のDOM変更がドラッグを中断する問題も、共通側の遅延で回避する。
test('reads an internal snapshot during protected events and publishes reactive data later', async t => {
	const f = fixture(t);
	const data = { sceneId: 'scene', layerId: 'layer' };
	startDragSession(f.event('dragstart'), 'source', 'TimelineLayer', data);
	data.layerId = 'changed';
	assert.equal(getDragSessionData('TimelineLayer'), null);
	assert.deepEqual(getActiveDragData(f.event('dragover'), 'TimelineLayer', 'source'), { sceneId: 'scene', layerId: 'layer' });
	assert.equal(getActiveDragData(f.event('dragover'), 'TimelineLayer', 'other-instance'), null);
	assert.equal(getActiveDragData(f.event('dragover'), 'GsAsset'), null);
	const external = new Event('dragover');
	external.dataTransfer = { types: ['glitch-studio/timelinelayer'] };
	assert.equal(getActiveDragData(external, 'TimelineLayer'), null);
	await settle();
	assert.deepEqual(getDragSessionData('TimelineLayer', 'source'), { sceneId: 'scene', layerId: 'layer' });
	assert.equal(getDragSessionData('TimelineLayer', 'other-instance'), null);
});

// 【中断・ドラッグ終了・別ドラッグ開始でセッションと遅延処理を解放する】
// 終了後にタイマーが古い表示を復活させたり、終了通知が他のドラッグへ移動通知を送ったりしない。
test('cleans up cancellation listeners and pending publication without notifying a move', async t => {
	for (const type of ['dragend', 'blur', 'dragstart']) {
		const f = fixture(t);
		let moved = 0;
		startDragSession(f.event('dragstart'), 'source', 'GsAsset', { assetId: 'asset' }, () => { moved++; });
		f.windowTarget.dispatchEvent(new Event(type));
		await settle();
		assert.equal(getActiveDragData(f.event('dragover'), 'GsAsset'), null);
		assert.equal(getDragSessionData('GsAsset'), null);
		assert.equal(f.windowTarget.listeners.size, 0);
		assert.equal(moved, 0);
	}
});

// 【dropを受け付けた全ハンドラーが読み終わってから、未処理のドロップも破棄する】
// captureでデータを先に消すと受け取り側が読めなくなる。伝播停止や別ウィンドウの受付でも終了する。
test('keeps data through drop dispatch and expires it after handlers in any document', async t => {
	const f = fixture(t);
	startDragSession(f.event('dragstart'), 'source', 'WorkspacePanel', { id: 'panel' });
	f.read();
	f.windowTarget.dispatchEvent(f.event('drop'));
	assert.deepEqual(getActiveDragData(f.event('drop'), 'WorkspacePanel'), { id: 'panel' });
	assert.deepEqual(getActiveDragData(f.event('drop'), 'WorkspacePanel'), { id: 'panel' });
	await Promise.resolve();
	assert.deepEqual(getActiveDragData(f.event('drop'), 'WorkspacePanel'), { id: 'panel' });
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(getActiveDragData(f.event('dragover'), 'WorkspacePanel'), null);
	startDragSession(f.event('dragstart'), 'source', 'WorkspacePanel', { id: 'panel' });
	const otherDocument = { ownerDocument: { defaultView: new EventTarget() } };
	assert.deepEqual(getActiveDragData(f.event('drop', otherDocument), 'WorkspacePanel'), { id: 'panel' });
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(getActiveDragData(f.event('dragover'), 'WorkspacePanel'), null);
	assert.equal(f.windowTarget.listeners.size, 0);
});

// 【同種別の新しいドラッグを開始しても、古いイベントや開始元の破棄に影響されない】
// ドラッグ種別だけでは同じレイヤーを続けてドラッグした場合に区別できないため、セッションごとの印を使う。
test('isolates replacement sessions from old markers and queued cleanup', async t => {
	const f = fixture(t);
	const replacement = fixture(t);
	startDragSession(f.event('dragstart'), 'source', 'GsAsset', { assetId: 'old' });
	f.windowTarget.dispatchEvent(f.event('drop'));
	startDragSession(replacement.event('dragstart', f.source), 'replacement', 'GsAsset', { assetId: 'new' });
	f.windowTarget.dispatchEvent(f.event('dragend'));
	f.windowTarget.dispatchEvent(f.event('drop'));
	finishDragSession('source');
	await Promise.resolve();
	assert.equal(getActiveDragData(f.event('dragover'), 'GsAsset'), null);
	assert.deepEqual(getActiveDragData(replacement.event('dragover'), 'GsAsset'), { assetId: 'new' });
	assert.equal(replacement.windowTarget.listeners.size, 0);
});

// 【インスタンス間移動が確定したときだけ開始元へ通知し、不一致のドロップは拒否する】
// キャンセルや同一リスト内の並び替えで開始元の要素を削除しない。ブラウザ側の書き換えも検証する。
test('notifies only completed cross-instance moves and rejects modified drop data', t => {
	const f = fixture(t);
	let moved = 0;
	const start = () => startDragSession(f.event('dragstart'), 'source', 'GsDraggable', { item: { id: 'item' }, group: 'group' }, () => { moved++; });
	f.read();
	start();
	completeDragSession(f.event('drop'), 'source');
	assert.equal(moved, 0);
	start();
	completeDragSession(f.event('drop'), 'target');
	completeDragSession(f.event('drop'), 'target');
	assert.equal(moved, 1);
	start();
	f.values.set('glitch-studio/gsdraggable', JSON.stringify({ item: { id: 'another' }, group: 'group' }));
	assert.equal(getActiveDragData(f.event('drop'), 'GsDraggable'), null);
	completeDragSession(f.event('drop'), 'target');
	assert.equal(moved, 1);
});
