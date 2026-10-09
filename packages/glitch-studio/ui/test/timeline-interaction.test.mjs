import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setImmediate as settle } from 'node:timers/promises';
import { build } from 'esbuild';
import { createRenderer, nextTick, ref, shallowRef } from 'vue';

const directory = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: directory, stdin: {
	contents: `export * from './src/composables/useTimelineInteraction.ts';
		export * from './src/composables/useTimelineMarqueeSelection.ts';
		export * from './src/composables/useTimelineSelectionDrag.ts';
		export * from './src/composables/useTimelineViewport.ts';
		export * from './src/utility/virtual-scroll.ts';`, resolveDir: directory, loader: 'ts',
}, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false });
const bundled = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { useTimelineInteraction, useTimelineMarqueeSelection, useTimelineSelectionDrag, useTimelineViewport,
	createVirtualScrollLayout, findVirtualScrollItem } = bundled.exports;

// DOMの境界とイベントだけを用意し、操作の状態・Vueの監視・Pointer Captureの後始末は実装を使う。
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
class EventSurface {
	listeners = new Map();
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
	}
	removeEventListener(type, listener) {
		this.listeners.get(type)?.delete(listener);
		if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
	}
	dispatch(type, event = {}) { for (const listener of [...this.listeners.get(type) ?? []]) listener(event); }
}
class TestElement extends EventSurface {
	offsetWidth = 1000;
	offsetHeight = 500;
	scrollTop = 0;
	dataset = {};
	captured = new Set();
	ignored = false;
	constructor(ownerWindow, parent = null) { super(); this.ownerDocument = { defaultView: ownerWindow }; this.parent = parent; }
	getBoundingClientRect() { return { left: 200, right: 1200, top: 100, bottom: 600, width: this.offsetWidth, height: this.offsetHeight }; }
	contains(target) { return target === this || (target?.parent != null && this.contains(target.parent)); }
	closest(selector) {
		if (selector === '[data-timeline-surface]') return this;
		if (selector === '[data-timeline-layer-id]') return this.dataset.timelineLayerId ? this : this.parent?.closest(selector);
		return this.ignored ? this : null;
	}
	focus() {}
	setPointerCapture(id) { this.captured.add(id); }
	hasPointerCapture(id) { return this.captured.has(id); }
	releasePointerCapture(id) { this.captured.delete(id); }
}
function pointer(target, overrides = {}) {
	return { target, currentTarget: target, button: 0, buttons: 1, isPrimary: true, pointerId: 1, clientX: 210, clientY: 135,
		shiftKey: false, ctrlKey: false, metaKey: false, prevented: false, stopped: false,
		preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
}

async function fixture(t) {
	const previousElement = globalThis.Element;
	const previousResizeObserver = globalThis.ResizeObserver;
	const observers = [];
	globalThis.Element = TestElement;
	globalThis.ResizeObserver = class {
		constructor(callback) { this.callback = callback; observers.push(this); }
		observe() {}
		disconnect() { this.disconnected = true; }
	};
	const ownerWindow = new EventSurface();
	const timeline = new TestElement(ownerWindow);
	const layers = new TestElement(ownerWindow);
	const layout = createVirtualScrollLayout(['a', 'b', 'c'], new Map(), 100, 0);
	const rows = layout.items.map(item => {
		const row = new TestElement(ownerWindow, layers);
		row.dataset.timelineLayerId = item.key;
		row.getBoundingClientRect = () => ({ top: 120 + item.top - layers.scrollTop });
		row.querySelector = () => ({ getBoundingClientRect: () => ({ top: row.getBoundingClientRect().top + 10, bottom: row.getBoundingClientRect().top + 30 }) });
		row.querySelectorAll = () => [];
		return row;
	});
	// 中間行bのDOMがなくても候補を選べるよう、境界行だけを公開する。
	layers.querySelectorAll = () => [rows[0], rows[2]];
	const pendingMeasurements = [];
	const virtualLayers = {
		getClientTop: () => 120 - layers.scrollTop, getLayout: () => layout,
		getItemAt: y => findVirtualScrollItem(layout, y),
		refresh: () => new Promise(resolve => pendingMeasurements.push(resolve)),
	};
	const timelineElement = shallowRef(timeline);
	const layersElement = shallowRef(layers);
	const sceneId = ref('scene');
	const selection = shallowRef({ kind: 'layers', ids: ['old'] });
	const layerSizeKeys = shallowRef(new Map([['a', ''], ['b', ''], ['c', '']]));
	const playback = { currentTime: ref(1000), isPlaying: ref(false), followPlayhead: ref(false) };
	const sought = [];
	let revealed = 0;
	let interaction;
	let viewport;
	let drag;
	let marquee;
	const app = renderer.createApp({ setup() {
		interaction = useTimelineInteraction();
		viewport = useTimelineViewport({ timelineElement, layersElement, savedState: { positionX: 0, rangeX: 1000 }, ...playback,
			tickMode: ref('decimal125'), tickSubdivisions: ref({ halves: false, thirds: false }), interactionActive: interaction.active });
		drag = useTimelineSelectionDrag({ timelineElement, layersElement, viewport, interaction, duration: ref(1000),
			snapSettings: ref({ enabled: true, globalTicks: true, localTicks: false, seekBar: false }), snapSeekBar: ref(true), seek: time => sought.push(time) });
		marquee = useTimelineMarqueeSelection({ timelineElement, layersElement, viewport, interaction, selection,
			sceneId: () => sceneId.value, virtualLayers: shallowRef(virtualLayers), rulerHeight: 20, layerSizeKeys,
			layers: shallowRef(layout.items.map(item => ({ id: item.key, clips: [{ id: 'clip', startMs: 20, durationMs: 80 }], lanes: [] }))),
			revealDetails: () => { revealed++; },
		});
		return () => null;
	} });
	app.mount({});
	let disposed = false;
	function dispose() {
		if (disposed) return;
		disposed = true;
		app.unmount();
		globalThis.Element = previousElement;
		globalThis.ResizeObserver = previousResizeObserver;
	}
	t.after(dispose);
	await nextTick();
	async function flushMeasurements() {
		while (pendingMeasurements.length) {
			for (const resolve of pendingMeasurements.splice(0)) resolve();
			await settle();
		}
	}
	return { interaction, viewport, drag, marquee, timeline, layers, rows, ownerWindow, selection, sceneId, layerSizeKeys, playback, sought,
		pendingMeasurements, flushMeasurements, dispose, observer: observers[0], get revealed() { return revealed; } };
}

// 【しきい値判定中も他操作と追従を止め、ズーム後の座標で移動して最後の位置まで適用する】
// ポインターがまだ3px動いていない時点から排他が必要。ドラッグ途中の倍率変更と往復でも
// 開始時の時刻を基準にし、一回のUndoへまとめるmergeKeyとクリック抑止を維持する。
test('locks competing gestures before movement and keeps the drag origin and merge key across zoom', async t => {
	const f = await fixture(t);
	const applied = [];
	f.drag.startSelectionMove(pointer(f.timeline, { clientX: 250 }), [{ time: 0, minDelta: -200, maxDelta: 500 }], [100],
		(delta, mergeKey) => { applied.push({ delta, mergeKey }); return true; });
	assert.equal(f.interaction.active.value, true);
	assert.equal(f.drag.movingSelection.value, false);
	f.viewport.onPanMousedown(pointer(f.timeline, { button: 1 }));
	assert.equal(f.viewport.panning.value, false);
	f.drag.onSeekBarPointerDown(pointer(f.timeline));
	f.marquee.onBackgroundPointerDown(pointer(f.rows[0]));
	assert.equal(f.pendingMeasurements.length, 0);
	assert.deepEqual(f.sought, []);
	f.playback.followPlayhead.value = true;
	f.playback.isPlaying.value = true;
	await nextTick();
	assert.equal(f.viewport.positionX.value, 0);
	f.ownerWindow.dispatch('pointermove', pointer(f.timeline, { clientX: 252 }));
	assert.equal(applied.length, 0);
	f.ownerWindow.dispatch('pointermove', pointer(f.timeline, { clientX: 348 }));
	assert.equal(f.drag.movingSelection.value, true);
	assert.deepEqual(f.drag.snappingTimes.value, [100]);
	f.viewport.rangeX.value = 2000;
	f.ownerWindow.dispatch('pointermove', pointer(f.timeline, { clientX: 300 }));
	f.ownerWindow.dispatch('pointerup', pointer(f.timeline, { clientX: 225 }));
	assert.deepEqual(applied.map(entry => entry.delta), [100, 150, 0]);
	assert.equal(new Set(applied.map(entry => entry.mergeKey)).size, 1);
	assert.equal(f.interaction.active.value, false);
	assert.equal(f.drag.movingSelection.value, false);
	assert.deepEqual(f.drag.snappingTimes.value, []);
	const click = pointer(f.timeline);
	f.interaction.onTimelineClick(click);
	assert.equal(click.stopped, true);
	const nextClick = pointer(f.timeline);
	f.interaction.onTimelineClick(nextClick);
	assert.equal(nextClick.stopped, false);
	f.playback.currentTime.value = 3000;
	await nextTick();
	assert.equal(f.viewport.positionX.value, 2000);
});

// 【移動・シークは全ての終了経路で登録元のリスナーと表示状態を解放する】
// 別ウィンドウへの移動、Capture喪失、対象削除による適用中止、パネル破棄でも操作中を残さない。
test('releases drag and seek sessions on cancellation, blur, lost capture, invalid targets and disposal', async t => {
	for (const kind of ['move', 'seek']) {
		for (const ending of ['pointercancel', 'blur', 'pagehide', 'lostpointercapture', 'dispose', 'invalid']) {
			if (kind === 'seek' && ending === 'invalid') continue;
			const f = await fixture(t);
			let valid = true;
			if (kind === 'move') f.drag.startSelectionMove(pointer(f.timeline), [{ time: 0, minDelta: 0, maxDelta: 1000 }], [], () => valid);
			else f.drag.onSeekBarPointerDown(pointer(f.timeline));
			f.ownerWindow.dispatch('pointermove', pointer(f.timeline, { clientX: 350 }));
			const capture = kind === 'move' ? f.layers : f.timeline;
			capture.ownerDocument.defaultView = new EventSurface();
			if (ending === 'dispose') f.dispose();
			else if (ending === 'lostpointercapture') capture.dispatch(ending, pointer(capture));
			else if (ending === 'invalid') {
				valid = false;
				f.ownerWindow.dispatch('pointermove', pointer(f.timeline, { clientX: 400 }));
			} else f.ownerWindow.dispatch(ending, pointer(f.timeline));
			assert.equal(f.interaction.active.value, false, kind + ':' + ending);
			assert.equal(f.drag.movingSelection.value, false);
			assert.deepEqual(f.drag.snappingTimes.value, []);
			assert.equal(f.ownerWindow.listeners.size, 0);
			assert.equal(capture.listeners.size, 0);
			assert.equal(capture.captured.size, 0);
			f.dispose();
		}
	}
});

// 【シーク中も同じ排他を使い、目盛りへ吸着してScene終端の手前に止める】
// 選択移動とは異なり、シークは各イベントの現在時刻を直接使い、ドラッグ後のクリックを抑止しない。
test('snaps seeking to ruler ticks, clamps its end and blocks selection while panning', async t => {
	const f = await fixture(t);
	f.drag.onSeekBarPointerDown(pointer(f.timeline));
	f.ownerWindow.dispatch('pointermove', pointer(f.timeline, { clientX: 398 }));
	assert.deepEqual(f.sought, [200]);
	assert.deepEqual(f.drag.snappingTimes.value, [200]);
	f.ownerWindow.dispatch('pointerup', pointer(f.timeline, { clientX: 1600 }));
	assert.deepEqual(f.sought, [200, 999]);
	const click = pointer(f.timeline);
	f.interaction.onTimelineClick(click);
	assert.equal(click.stopped, false);
	f.viewport.onPanMousedown(pointer(f.timeline, { button: 1 }));
	assert.equal(f.viewport.panning.value, true);
	assert.equal(f.drag.canStart(pointer(f.timeline)), false);
	f.marquee.onBackgroundPointerDown(pointer(f.rows[0]));
	assert.equal(f.interaction.active.value, false);
	assert.equal(f.pendingMeasurements.length, 0);
});

// 【対象外のポインター入力で操作を占有せず、背景クリックだけで既存選択を解除する】
// capture側がクリップや入力欄のイベントを見ても、子のドラッグ開始を妨げてはいけない。
// 3px未満のクリックではCaptureを移さず、レーンのダブルクリックによる追加を維持する。
test('ignores controls and out-of-bounds presses and clears background selection before capture', async t => {
	const f = await fixture(t);
	const ignored = new TestElement(f.ownerWindow, f.rows[0]);
	ignored.ignored = true;
	for (const event of [pointer(ignored), pointer(f.timeline, { clientY: 110 }), pointer(f.timeline, { clientX: 100 }),
		pointer(f.timeline, { button: 1 }), pointer(f.timeline, { isPrimary: false }), pointer(new TestElement(f.ownerWindow))]) {
		f.marquee.onBackgroundPointerDown(event);
		assert.equal(f.interaction.active.value, false);
	}
	f.marquee.onBackgroundPointerDown(pointer(f.rows[0]));
	assert.deepEqual(f.selection.value, { kind: 'layers', ids: [] });
	assert.equal(f.layers.captured.size, 0);
	f.ownerWindow.dispatch('pointerup', pointer(f.rows[0]));
	await f.flushMeasurements();
	assert.equal(f.interaction.active.value, false);
	assert.equal(f.revealed, 0);
	const click = pointer(f.timeline);
	f.interaction.onTimelineClick(click);
	assert.equal(click.stopped, false);
});

// 【pointerup後の計測を待って未描画行を含む選択を確定し、詳細を一度だけ開く】
// 終了時点で操作を解放すると、再生追従や次のドラッグで計測の座標が変わってしまう。
// Shift追加はドラッグ開始前の選択を基準にし、仮想一覧のlayout通知も同じ再計算へ集約する。
test('retains marquee ownership through final measurement and selects unmounted rows with shift', async t => {
	const f = await fixture(t);
	f.selection.value = { kind: 'clips', clips: [{ layerId: 'old', clipId: 'old' }] };
	f.marquee.onBackgroundPointerDown(pointer(f.rows[0], { shiftKey: true }));
	f.ownerWindow.dispatch('pointermove', pointer(f.rows[2], { clientX: 350, clientY: 335 }));
	f.marquee.onVirtualLayersLayout();
	f.ownerWindow.dispatch('pointerup', pointer(f.rows[2], { clientX: 350, clientY: 335 }));
	assert.equal(f.ownerWindow.listeners.size, 0);
	assert.equal(f.interaction.active.value, true);
	assert.equal(f.revealed, 0);
	f.viewport.onPanMousedown(pointer(f.timeline, { button: 1 }));
	assert.equal(f.viewport.panning.value, false);
	await f.flushMeasurements();
	assert.deepEqual(f.selection.value.clips.map(clip => clip.layerId), ['old', 'a', 'b', 'c']);
	assert.equal(f.interaction.active.value, false);
	assert.equal(f.marquee.selectionArea.value, null);
	assert.equal(f.revealed, 1);
	assert.equal(f.layers.listeners.size, 0);
});

// 【古い非同期計測の完了で次のドラッグや選択表示を解除しない】
// レーン変更で範囲選択を中止した直後に再操作でき、古いfinallyも新しい所有権を解放しない。
test('does not let a cancelled measurement finish or clear the next marquee session', async t => {
	const f = await fixture(t);
	f.marquee.onBackgroundPointerDown(pointer(f.rows[0]));
	f.ownerWindow.dispatch('pointermove', pointer(f.rows[2], { clientX: 350, clientY: 335 }));
	f.layerSizeKeys.value = new Map([['a', 'changed'], ['b', ''], ['c', '']]);
	assert.equal(f.interaction.active.value, false);
	f.marquee.onBackgroundPointerDown(pointer(f.rows[0]));
	f.pendingMeasurements.shift()();
	await settle();
	assert.equal(f.interaction.active.value, true);
	assert.equal(f.revealed, 0);
	f.ownerWindow.dispatch('pointerup', pointer(f.rows[2], { clientX: 350, clientY: 335 }));
	await f.flushMeasurements();
	assert.deepEqual(f.selection.value.clips.map(clip => clip.layerId), ['a', 'b', 'c']);
	assert.equal(f.revealed, 1);
});

// 【寸法・Scene変更とスコープ終了では計測待ちを中止し、終了後に選択を書き換えない】
// pointerup後はPointer Captureのリスナーがなくても計測が残るため、操作の寿命で停止させる。
test('cancels pending marquee measurement on resize, scene changes and disposal', async t => {
	for (const ending of ['resize', 'scene', 'dispose']) {
		const f = await fixture(t);
		f.marquee.onBackgroundPointerDown(pointer(f.rows[0]));
		f.ownerWindow.dispatch('pointerup', pointer(f.rows[2], { clientX: 350, clientY: 335 }));
		if (ending === 'resize') { f.timeline.offsetWidth = 900; f.observer.callback(); }
		else if (ending === 'scene') f.sceneId.value = 'other';
		else f.dispose();
		assert.equal(f.interaction.active.value, false);
		await f.flushMeasurements();
		assert.deepEqual(f.selection.value, { kind: 'layers', ids: [] });
		assert.equal(f.marquee.selectionArea.value, null);
		assert.equal(f.layers.listeners.size, 0);
		assert.equal(f.revealed, 0);
		f.dispose();
	}
});
