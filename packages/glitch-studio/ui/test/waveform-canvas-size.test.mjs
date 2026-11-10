import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRenderer, shallowRef } from 'vue';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/use-waveform-canvas-size.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { useWaveformCanvasSize } = module.exports;

function view(ratio) {
	const result = new EventTarget();
	result.devicePixelRatio = ratio;
	result.observers = [];
	result.queries = [];
	result.ResizeObserver = class {
		constructor(callback) { this.callback = callback; result.observers.push(this); }
		observe() { this.disconnected = false; }
		disconnect() { this.disconnected = true; }
		notify(width, height) { this.callback([{ contentRect: { width, height } }]); }
	};
	result.matchMedia = media => { const query = Object.assign(new EventTarget(), { media }); result.queries.push(query); return query; };
	return result;
}

function fixture(t) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const first = view(1.5);
	const element = { clientWidth: 320, clientHeight: 180, ownerDocument: { defaultView: first } };
	const calls = [];
	let monitor;
	const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });
	const app = renderer.createApp({ setup() { monitor = useWaveformCanvasSize(shallowRef(element), size => calls.push(size)); return () => null; } });
	app.mount({});
	let mounted = true;
	const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
	t.after(unmount);
	return { first, element, calls, monitor, unmount };
}

// 【表示領域のCSS実寸とDPRから物理画素数を求め、連続リサイズの最終値を反映する】
// Canvas属性の固定値やCSS寸法だけでは、高DPI画面で低解像度の波形が引き伸ばされる。
// 小数のCSS寸法も扱い、同じ寸法の再通知や非表示中の0寸法では余計な要求を送らない。
test('tracks physical panel size and coalesces resize notifications', t => {
	const f = fixture(t);
	f.first.observers[0].notify(320.5, 180.5);
	t.mock.timers.tick(50);
	f.first.observers[0].notify(420.5, 210.5);
	t.mock.timers.tick(50);
	assert.deepEqual(f.calls, [{ width: 631, height: 316 }]);
	assert.deepEqual(f.monitor.size.value, { width: 420.5, height: 210.5 });
	f.first.observers[0].notify(420.5, 210.5);
	t.mock.timers.tick(100);
	assert.equal(f.calls.length, 1);
	f.first.observers[0].notify(0, 0);
	t.mock.timers.tick(100);
	assert.equal(f.calls.length, 1);
});

// 【パネルを動かさずDPRだけが変わっても解像度を更新し、次のDPR変更も監視する】
// ブラウザーのズームや画面間の移動では、CSS寸法のResizeObserver通知が来るとは限らない。
test('updates resolution when the window pixel ratio changes without a CSS resize', t => {
	const f = fixture(t);
	t.mock.timers.tick(100);
	f.first.devicePixelRatio = 2;
	f.first.queries.at(-1).dispatchEvent(new Event('change'));
	t.mock.timers.tick(100);
	assert.deepEqual(f.calls.at(-1), { width: 640, height: 360 });
	assert.equal(f.first.queries.at(-1).media, '(resolution: 2dppx)');
	f.first.devicePixelRatio = 1;
	f.first.queries.at(-1).dispatchEvent(new Event('change'));
	t.mock.timers.tick(100);
	assert.deepEqual(f.calls.at(-1), { width: 320, height: 180 });
});

// 【別ウィンドウへ移したら新しいDPRを使い、旧通知・破棄後の通知を無視する】
// 子の破棄時に届くchangeWindowで監視を復活させたり、以前の画面の寸法へ戻したりしない。
test('moves observation to the current window and cancels pending work on unmount', t => {
	const f = fixture(t);
	const second = view(2);
	f.element.ownerDocument.defaultView = second;
	f.monitor.changeWindow();
	assert.equal(f.first.observers[0].disconnected, true);
	f.first.observers[0].notify(999, 999);
	t.mock.timers.tick(100);
	assert.deepEqual(f.calls, [{ width: 640, height: 360 }]);
	second.observers[0].notify(600, 400);
	f.unmount();
	f.monitor.changeWindow();
	second.observers[0].notify(800, 500);
	t.mock.timers.tick(100);
	assert.equal(second.observers.length, 1);
	assert.equal(second.observers[0].disconnected, true);
	assert.equal(f.calls.length, 1);
});
