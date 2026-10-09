import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createRenderer, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';

const directory = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: directory, stdin: {
	contents: "export { useTimelineViewport } from './src/composables/useTimelineViewport.ts';", resolveDir: directory, loader: 'ts',
}, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false });
const bundled = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { useTimelineViewport } = bundled.exports;

// composableを実際のVueの寿命で動かす。描画は不要なので、nullを返すコンポーネントだけをマウントする。
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
class TestWindow {
	listeners = new Map();
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
	}
	removeEventListener(type, listener) {
		const listeners = this.listeners.get(type);
		listeners?.delete(listener);
		if (listeners?.size === 0) this.listeners.delete(type);
	}
	dispatch(type, event = {}) { for (const listener of [...this.listeners.get(type) ?? []]) listener(event); }
}
class TestElement {
	offsetWidth = 1000;
	offsetHeight = 500;
	left = 200;
	scrollTop = 80;
	focusOptions = null;
	surface = true;
	constructor(ownerWindow) { this.ownerDocument = { defaultView: ownerWindow }; }
	closest() { return this.surface ? this : null; }
	getBoundingClientRect() { return { left: this.left }; }
	focus(options) { this.focusOptions = options; }
}
function event(target, overrides = {}) {
	return { target, clientX: 450, clientY: 200, button: 1, buttons: 4, deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: false,
		prevented: false, stopped: false,
		preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

async function fixture(t, { savedState = { positionX: 100, rangeX: 1000 }, beforeUnmount, initialWidth = 1000 } = {}) {
	const previousElement = globalThis.Element;
	const previousResizeObserver = globalThis.ResizeObserver;
	const observers = [];
	globalThis.Element = TestElement;
	globalThis.ResizeObserver = class {
		disconnected = false;
		constructor(callback) { this.callback = callback; observers.push(this); }
		observe(element) { this.element = element; }
		disconnect() { this.disconnected = true; }
	};
	const ownerWindow = new TestWindow();
	const timeline = new TestElement(ownerWindow);
	timeline.offsetWidth = initialWidth;
	const layers = new TestElement(ownerWindow);
	const options = { timelineElement: shallowRef(timeline), layersElement: shallowRef(layers), savedState,
		currentTime: ref(1000), isPlaying: ref(false), followPlayhead: ref(false), interactionActive: ref(false),
		tickMode: ref('binary'), tickSubdivisions: ref({ halves: false, thirds: false }) };
	let viewport;
	const app = renderer.createApp({ setup() {
		viewport = useTimelineViewport(options);
		onBeforeUnmount(() => beforeUnmount?.(viewport));
		return () => null;
	} });
	app.mount({});
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		app.unmount();
		globalThis.Element = previousElement;
		globalThis.ResizeObserver = previousResizeObserver;
	};
	t.after(dispose);
	await nextTick();
	return { viewport, options, timeline, layers, ownerWindow, observer: observers[0], dispose };
}

// 【保存された表示範囲を復元し、サイズと目盛り設定の変更に同じ座標系で追従する】
// 切り出しで小数msを丸めたり、目盛りだけ古い幅を使うとドラッグ・描画・スナップがずれてしまう。
test('restores the viewport and updates coordinates and ticks after resize and preference changes', async t => {
	const f = await fixture(t);
	const v = f.viewport;
	assert.equal(v.positionX.value, 100);
	assert.equal(v.rangeX.value, 1000);
	assert.equal(v.width.value, 1000);
	assert.equal(v.height.value, 500);
	assert.equal(v.timeAtClientX(450.25), 350.25);
	assert.equal(v.timeAtX(250.25), 350.25);
	assert.equal(v.timeToX(350.25), 250.25);
	f.timeline.offsetWidth = 500;
	f.timeline.offsetHeight = 700;
	f.observer.callback();
	assert.equal(v.height.value, 700);
	assert.equal(v.timeAtClientX(450.25), 600.5);
	assert.equal(v.timeToX(350.25), 125.125);
	assert.equal(v.tickCount.value, 5);
	assert.deepEqual(v.ticks.value, [0, 250, 500, 750, 1000, 1250]);
	f.options.tickMode.value = 'decimal125';
	f.options.tickSubdivisions.value = { halves: true, thirds: true };
	assert.deepEqual(v.ticks.value, [0, 200, 400, 600, 800, 1000, 1200]);
	assert.ok(v.minorTicks.value.includes(100));
	assert.ok(v.minorTicks.value.includes(200 / 3));
	assert.ok(v.ticksWithMinor.value.every((time, index, times) => index === 0 || times[index - 1] <= time));
	f.timeline.left = 350;
	assert.equal(v.timeAtClientX(350), 100);
});

// 【ホイールの単位を揃え、カーソル直下の時刻を保ったまま横ズームする】
// ShiftでdeltaXが届く環境でも倍率が変わらず、キャプチャで背景ズームとの二重処理を止める。
test('normalizes ruler wheel units and captures shift zoom without moving the pointer anchor', async t => {
	const f = await fixture(t);
	const v = f.viewport;
	const wheel = event(f.timeline, { shiftKey: true, deltaY: 0, deltaX: -2, deltaMode: 1 });
	v.onTimelineWheel(wheel);
	assert.equal(wheel.prevented, true);
	assert.equal(wheel.stopped, true);
	close(v.rangeX.value, 1000 * Math.exp(-32 / 1000));
	close(v.timeAtClientX(450), 350);
	const range = v.rangeX.value;
	v.onRulerWheel(event(f.timeline, { deltaY: 0.1, deltaMode: 2 }));
	close(v.rangeX.value, range * Math.exp(0.1));
	close(v.timeAtClientX(450), 350);
	const ignored = event(f.timeline);
	v.onTimelineWheel(ignored);
	assert.equal(ignored.prevented, false);
	f.timeline.surface = false;
	const outside = event(f.timeline, { shiftKey: true });
	v.onTimelineWheel(outside);
	assert.equal(outside.prevented, false);
});

// 【背景ホイールは既存の倍率とアンカーを維持する】
// 背景と目盛りでは倍率の計算が異なるため、単に同じズーム関数へ置き換えて操作感を変えない。
test('preserves the existing background zoom factor and its pointer anchor', async t => {
	const f = await fixture(t);
	const wheel = event(f.timeline);
	f.viewport.onBackgroundWheel(wheel);
	assert.equal(f.viewport.rangeX.value, 1100);
	close(f.viewport.timeAtClientX(450), 350);
	assert.equal(wheel.prevented, true);
	assert.equal(wheel.stopped, false);
	assert.equal(f.layers.scrollTop, 80);
});

// 【パンは横の時刻と縦の一覧スクロールを動かし、開始元ウィンドウで終了する】
// 別ウィンドウへ移動しても登録先から解除し、ボタン解放・フォーカス喪失でリスナーを残さない。
test('pans both axes and cleans up the original window on every termination path', async t => {
	const f = await fixture(t);
	for (const ending of ['mouseup', 'mouseleave', 'blur', 'pagehide', 'buttons']) {
		f.viewport.positionX.value = 100;
		f.layers.scrollTop = 80;
		f.viewport.onPanMousedown(event(f.timeline));
		assert.equal(f.viewport.panning.value, true);
		assert.equal(f.viewport.optimizeHorizontalMovement.value, true);
		assert.deepEqual(f.timeline.focusOptions, { preventScroll: true });
		f.ownerWindow.dispatch('mousemove', { clientX: 470, clientY: 225, buttons: 4 });
		assert.equal(f.viewport.positionX.value, 80);
		assert.equal(f.layers.scrollTop, 55);
		f.layers.ownerDocument.defaultView = new TestWindow();
		f.ownerWindow.dispatch(ending === 'buttons' ? 'mousemove' : ending, { buttons: 0 });
		assert.equal(f.viewport.panning.value, false);
		assert.equal(f.viewport.optimizeHorizontalMovement.value, false);
		assert.equal(f.ownerWindow.listeners.size, 0);
		f.layers.ownerDocument.defaultView = f.ownerWindow;
	}
});

// 【選択・シーク操作やパンの間だけ再生追従を止め、操作終了で再開する】
// 移動開始前のしきい値判定や範囲選択の非同期計測も含め、操作側が渡した状態をそのまま使う。
// 終了後に別の再生時刻更新がなくても追従が戻ることを確認する。
test('suspends follow and pan while an interaction is active and resumes follow after it ends', async t => {
	const f = await fixture(t);
	const v = f.viewport;
	f.options.followPlayhead.value = true;
	f.options.isPlaying.value = true;
	await nextTick();
	assert.equal(v.positionX.value, 500);
	f.options.interactionActive.value = true;
	f.options.currentTime.value = 2000;
	const blockedPan = event(f.timeline);
	v.onPanMousedown(blockedPan);
	assert.equal(blockedPan.prevented, false);
	assert.equal(v.panning.value, false);
	await nextTick();
	assert.equal(v.positionX.value, 500);
	v.rangeX.value = 2000;
	await nextTick();
	assert.equal(v.positionX.value, 500);
	f.options.interactionActive.value = false;
	await nextTick();
	assert.equal(v.positionX.value, 1000);
	v.onPanMousedown(event(f.timeline));
	f.options.currentTime.value = 3000;
	await nextTick();
	assert.equal(v.positionX.value, 1000);
	f.ownerWindow.dispatch('mouseup');
	await nextTick();
	assert.equal(v.positionX.value, 2000);
	f.options.followPlayhead.value = false;
	f.options.currentTime.value = 4000;
	await nextTick();
	assert.equal(v.positionX.value, 2000);
	assert.equal(v.optimizeHorizontalMovement.value, false);
});

// 【非表示で幅がない間はポインター時刻を解決せず、実測後に追従する】
// パネルの初回表示やリサイズ途中でInfinityを操作へ渡したり、保存位置を壊さないようにする。
test('waits for a measurable width before converting pointer positions or following playback', async t => {
	const f = await fixture(t, { initialWidth: 0 });
	f.options.followPlayhead.value = true;
	f.options.isPlaying.value = true;
	await nextTick();
	assert.equal(f.viewport.positionX.value, 100);
	assert.equal(f.viewport.timeAtClientX(450), null);
	f.viewport.onRulerWheel(event(f.timeline));
	assert.equal(f.viewport.rangeX.value, 1000);
	f.timeline.offsetWidth = 1000;
	f.observer.callback();
	await nextTick();
	assert.equal(f.viewport.positionX.value, 500);
	f.options.timelineElement.value = null;
	assert.equal(f.viewport.timeAtClientX(450), null);
});

// 【CUEの巻き戻し後の表示範囲を保存し、次のマウントで復元する】
// composableの登録順だけでonBeforeUnmountへ保存すると、親が戻す前の試聴中の位置を保存してしまう。
// onUnmountedを待たず次のsetupへ渡し、進行中のパンとResizeObserverも同じ寿命で解放する。
test('persists after the parent restores cue position and releases resources before the next mount', async t => {
	const savedState = { positionX: 100, rangeX: 1000 };
	const f = await fixture(t, { savedState, beforeUnmount: viewport => { viewport.positionX.value = 100; } });
	f.viewport.positionX.value = 5000;
	f.viewport.rangeX.value = 2000;
	f.viewport.onPanMousedown(event(f.timeline));
	assert.deepEqual(savedState, { positionX: 100, rangeX: 1000 });
	f.dispose();
	assert.equal(f.ownerWindow.listeners.size, 0);
	assert.equal(f.observer.disconnected, true);
	assert.deepEqual(savedState, { positionX: 100, rangeX: 2000 });
	const reopened = await fixture(t, { savedState });
	assert.equal(reopened.viewport.positionX.value, 100);
	assert.equal(reopened.viewport.rangeX.value, 2000);
});
