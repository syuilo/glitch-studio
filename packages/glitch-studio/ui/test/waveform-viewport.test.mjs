import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, ref, shallowRef } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

async function bundleComponent(name) {
	const componentPath = new URL(`../src/components/${name}.vue`, import.meta.url);
	const descriptor = parse(await readFile(componentPath, 'utf8'), { filename: fileURLToPath(componentPath) }).descriptor;
	const script = compileScript(descriptor, { id: 'waveform-viewport', inlineTemplate: true, genDefaultAs: 'component' }).content;
	return build({
		stdin: { contents: `${script}\ncomponent.__cssModules = { $style: {} }; export default component;
			export { zoomImageAnalysisViewport, panImageAnalysisViewport, selectImageAnalysisViewport } from '../utility/image-analysis-viewport.ts';`, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
		bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
		plugins: [i18nPlugin, { name: 'waveform-context', setup(build) {
			build.onResolve({ filter: /^@\/app\.ts$|GsDetachableView\.vue$|GsImageAnalysisSettings\.vue$|use-renderer-canvas\.ts$|use-waveform-canvas-size\.ts$/ }, args => ({ path: args.path, namespace: 'waveform-context' }));
			build.onLoad({ filter: /.*/, namespace: 'waveform-context' }, args => ({ loader: 'ts', contents:
				args.path.endsWith('app.ts') ? 'export const appContext = dependencies.state;'
				: args.path.endsWith('GsDetachableView.vue') ? `export default { emits: ['changeWindow'], setup(_props, { slots, emit }) {
					dependencies.changeWindow = () => emit('changeWindow'); return () => slots.default?.(); } };`
				: args.path.endsWith('GsImageAnalysisSettings.vue') ? 'export default { render: () => null };'
				: args.path.endsWith('use-renderer-canvas.ts') ? 'export function useRendererCanvas() {}'
				: 'export function useWaveformCanvasSize() { return { size: dependencies.size, changeWindow() {} }; }',
			}));
		} }],
	});
}

const [waveformBundle, histogramBundle] = await Promise.all([bundleComponent('GsWaveform'), bundleComponent('GsHistogram')]);

function fixture(t, direction = 'horizontal') {
	const histogram = direction === 'histogram';
	const view = new EventTarget();
	view.ResizeObserver = class {
		constructor(callback) { this.callback = callback; }
		observe() { this.callback([{ contentRect: { width: 400, height: 240 } }]); }
		disconnect() {}
	};
	const doc = new EventTarget();
	doc.defaultView = view;
	function element(tag) {
		let capture = null;
		const node = new EventTarget();
		return markRaw(Object.assign(node, { tag, props: {}, children: [], parent: null, text: '', ownerDocument: doc,
			clientWidth: 400, clientHeight: 240, clientLeft: 0, clientTop: 0,
			getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 240 }),
			focus() {},
			setPointerCapture(id) { capture = id; }, hasPointerCapture: id => capture === id,
			releasePointerCapture() { capture = null; node.dispatchEvent(new Event('lostpointercapture')); },
		}));
	}
	const renderer = createRenderer({
		createElement: element, createText: text => Object.assign(element('text'), { text }), createComment: () => element('comment'),
		setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
		patchProp(node, key, _previous, value) { node.props[key] = value; },
		insert(node, parent, anchor = null) { parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node); node.parent = parent; },
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const full = { x: 0, y: 0, width: 1, height: 1 };
	let flushes = 0;
	const state = {
		analysisHistogramViewport: shallowRef(null), analysisWaveformViewports: shallowRef(null), imageAnalysisRenderer: shallowRef(null), renderEngine: { isSuspended: ref(false) },
		displayedImageAnalysisSettings: shallowRef({ target: 'vectorX', valueScale: 'linear', valueRange: { minimum: 0, maximum: 1 }, waveformCanvasSizes: null, waveformViewports: null, histogramViewport: null }),
		setWaveformCanvasSize() {},
		setHistogramViewport(range) { state.analysisHistogramViewport.value = { ...range }; },
		setWaveformViewport(direction, viewport) { state.analysisWaveformViewports.value = { horizontal: { ...full }, vertical: { ...full }, ...state.analysisWaveformViewports.value, [direction]: { ...viewport } }; },
		flushImageAnalysisDisplay() { flushes++; },
	};
	const dependencies = { state, size: shallowRef({ width: 400, height: 240 }) };
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'dependencies', (histogram ? histogramBundle : waveformBundle).outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, dependencies);
	const root = element('root');
	const app = renderer.createApp({ render: () => h(module.exports.default, histogram ? {} : { direction }) });
	app.mount(root);
	let mounted = true;
	const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
	t.after(unmount);
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	const find = attribute => descendants(root).find(node => attribute in node.props);
	const text = node => node.text + node.children.map(text).join('');
	const plot = find(histogram ? 'data-test-histogram-plot' : 'data-test-waveform-plot');
	return { state, doc, view, plot, find, text, unmount, ...module.exports,
		get viewport() {
			const range = state.analysisHistogramViewport.value;
			return histogram ? { ...full, x: range?.minimum ?? 0, width: (range?.maximum ?? 1) - (range?.minimum ?? 0) } : state.analysisWaveformViewports.value?.[direction] ?? full;
		},
		get flushes() { return flushes; },
		wheel(props = {}) { plot.props.onWheel({ deltaY: -600, deltaMode: 0, clientX: 110, clientY: 200, preventDefault() {}, ...props }); },
		start(button = 1, props = {}) { plot.props.onPointerdown({ currentTarget: plot, pointerId: 7, isPrimary: true, button, clientX: 210, clientY: 140, preventDefault() {}, ...props }); },
		pointer(type, props = {}) { doc.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 7, clientX: 250, clientY: 116, ...props })); },
		apply() { state.displayedImageAnalysisSettings.value = { ...state.displayedImageAnalysisSettings.value, waveformViewports: structuredClone(state.analysisWaveformViewports.value), histogramViewport: structuredClone(state.analysisHistogramViewport.value) }; },
		changeWindow: () => dependencies.changeWindow(),
	};
}

// 【ホイールの支点を保ち、拡大率と表示範囲を解析領域の内側へ収める】
// パンした後のズームでも直下のデータを見失わず、極端な入力で0幅や領域外を作らない。
test('keeps the zoom anchor and clamps zoom and pan to the waveform extent', t => {
	const f = fixture(t);
	const anchor = { x: 0.25, y: 0.75 };
	const zoomed = f.zoomImageAnalysisViewport(f.viewport, anchor, 2);
	assert.deepEqual(zoomed, { x: 0.125, y: 0.375, width: 0.5, height: 0.5 });
	assert.equal(zoomed.x + anchor.x * zoomed.width, anchor.x);
	assert.equal(zoomed.y + anchor.y * zoomed.height, anchor.y);
	assert.deepEqual(f.zoomImageAnalysisViewport(zoomed, anchor, 0.5), f.viewport);
	assert.equal(f.zoomImageAnalysisViewport(zoomed, anchor, 1e10).width, 0.01);
	assert.deepEqual(f.panImageAnalysisViewport(zoomed, { x: 1e6, y: -1e6 }, { width: 400, height: 240 }), { ...zoomed, x: 0, y: 0.5 });
});

for (const direction of ['horizontal', 'vertical']) {
	// 【再解析完了までは旧目盛りを保ち、完了後に画像位置・値軸を同じ拡大範囲へ切り替える】
	// 横波形の上向きの値軸と縦波形の右向きの値軸を取り違えると、値を逆に読んでしまう。
	test(`zooms at the pointer and labels the completed viewport: ${direction}`, async t => {
		const f = fixture(t, direction);
		f.wheel();
		await nextTick();
		assert.deepEqual(f.viewport, { x: 0.125, y: 0.375, width: 0.5, height: 0.5 });
		assert.ok(f.text(f.find('data-test-waveform-x-axis')).includes(direction === 'horizontal' ? '100%' : '1'));
		f.apply();
		await nextTick();
		const xAxis = f.text(f.find('data-test-waveform-x-axis'));
		const yAxis = f.text(f.find('data-test-waveform-y-axis'));
		assert.ok(xAxis.includes(direction === 'horizontal' ? '13%' : '0.13'));
		assert.ok(xAxis.includes(direction === 'horizontal' ? '63%' : '0.63'));
		assert.ok(yAxis.includes(direction === 'horizontal' ? '0.63' : '38%'));
		assert.ok(yAxis.includes(direction === 'horizontal' ? '0.13' : '88%'));
		f.plot.props.onKeydown({ key: 'Home', preventDefault() {} });
		await nextTick();
		assert.deepEqual(f.viewport, { x: 0, y: 0, width: 1, height: 1 });
		assert.equal(f.flushes, 1);
	});
}

// 【中ボタンのドラッグで上下左右へ動かし、確定時に最後の値を送る】
// 移動量はイベント回数ではなく開始位置との差から求め、mouseup後の余分な移動を適用しない。
test('pans with the middle button and flushes the final viewport', t => {
	const f = fixture(t);
	f.wheel();
	f.start(1);
	f.pointer('pointermove');
	assert.ok(Math.abs(f.viewport.x - 0.075) < 1e-12);
	assert.ok(Math.abs(f.viewport.y - 0.425) < 1e-12);
	f.pointer('pointerup');
	assert.equal(f.flushes, 1);
	const final = f.viewport;
	f.pointer('pointermove', { clientX: 999 });
	assert.deepEqual(f.viewport, final);
});

for (const direction of ['horizontal', 'vertical', 'histogram']) {
	// 【左ドラッグ中は選択枠だけを表示し、離したときに選択した表示領域へ一度だけ移動する】
	// ヒストグラムは縦方向に動かさなくてもX軸を選択でき、波形は両軸を同じ矩形へ合わせる。
	// 選択中のホイール・キー操作で表示領域が変わると、枠と解析領域が食い違うため抑止する。
	test(`fits the left-drag selection on release: ${direction}`, async t => {
		const f = fixture(t, direction);
		f.start(0, { clientX: 110, clientY: 80 });
		const end = { clientX: 310, clientY: direction === 'histogram' ? 80 : 200 };
		f.pointer('pointermove', end);
		f.wheel();
		f.plot.props.onKeydown({ key: '+', preventDefault() {} });
		await nextTick();
		assert.deepEqual(f.viewport, { x: 0, y: 0, width: 1, height: 1 });
		assert.equal(f.flushes, 0);
		assert.deepEqual(f.find('data-test-image-analysis-selection').props.style, {
			left: '25%', top: direction === 'histogram' ? '0%' : '25%', width: '50%', height: direction === 'histogram' ? '100%' : '50%',
		});
		f.pointer('pointerup', end);
		await nextTick();
		assert.deepEqual(f.viewport, { x: 0.25, y: direction === 'histogram' ? 0 : 0.25, width: 0.5, height: direction === 'histogram' ? 1 : 0.5 });
		assert.equal(f.flushes, 1);
		assert.ok(f.find('data-test-image-analysis-selection') == null);
	});

	// 【未完了のホイール要求があっても、選択範囲を表示済みの画像に対して解釈する】
	// 要求中の倍率を基準にすると、ユーザーが囲った範囲とは違う領域へ飛んでしまう。
	test(`selects the visible viewport while another zoom is pending: ${direction}`, t => {
		const f = fixture(t, direction);
		f.wheel();
		f.start(0, { clientX: 310, clientY: 200 });
		f.pointer('pointerup', { clientX: 110, clientY: 80 });
		assert.deepEqual(f.viewport, { x: 0.25, y: direction === 'histogram' ? 0 : 0.25, width: 0.5, height: direction === 'histogram' ? 1 : 0.5 });
		assert.equal(f.flushes, 1);
	});
}

// 【選択の取消しでは表示領域を変更せず、枠とイベント追跡を終了する】
// 途中の選択が後から確定したり、ウィンドウ移動・休止後に解析要求を送ったりしないようにする。
test('cancels a selection without submitting an analysis update', async t => {
	for (const reason of ['Escape', 'pointercancel', 'blur', 'window', 'suspend', 'unmount']) {
		const f = fixture(t);
		f.start(0, { clientX: 110, clientY: 80 });
		f.pointer('pointermove', { clientX: 310, clientY: 200 });
		if (reason === 'Escape') f.doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
		else if (reason === 'pointercancel') f.pointer('pointercancel');
		else if (reason === 'blur') f.view.dispatchEvent(new Event('blur'));
		else if (reason === 'window') f.changeWindow();
		else if (reason === 'suspend') f.state.renderEngine.isSuspended.value = true;
		else f.unmount();
		f.pointer('pointerup', { clientX: 999 });
		await nextTick();
		assert.deepEqual(f.viewport, { x: 0, y: 0, width: 1, height: 1 }, reason);
		assert.equal(f.flushes, 0, reason);
		assert.ok(f.find('data-test-image-analysis-selection') == null, reason);
	}
});

// 【クリック・幅0の選択はズームせず、領域外へドラッグした選択は端へ収める】
// わずかな手ぶれで最大倍率へ飛んだり、画面外の値域を要求したりしないための境界条件。
test('ignores clicks and clips selections to the plot extent', t => {
	const click = fixture(t);
	click.start(0); click.pointer('pointerup', { clientX: 211, clientY: 141 });
	assert.equal(click.flushes, 0);
	const line = fixture(t);
	line.start(0); line.pointer('pointerup', { clientX: 310, clientY: 140 });
	assert.equal(line.flushes, 0);
	const clipped = fixture(t);
	clipped.start(0, { clientX: 210, clientY: 140 });
	clipped.pointer('pointerup', { clientX: 999, clientY: 999 });
	assert.deepEqual(clipped.viewport, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
	const maximum = clipped.selectImageAnalysisViewport({ x: 0, y: 0, width: 1, height: 1 }, { x: 0.4, y: 0.6, width: 1e-5, height: 1e-5 });
	assert.equal(maximum.width, 0.01);
	assert.equal(maximum.height, 0.01);
});

// 【Esc・タッチの中断・ウィンドウ移動・休止・破棄ではドラッグ開始時へ戻す】
// 別ウィンドウのDocumentも追跡し、取り消した解析領域が保留要求から再適用されないようにする。
test('restores the viewport and stops panning when an interaction is cancelled', t => {
	for (const reason of ['Escape', 'pointercancel', 'blur', 'window', 'suspend', 'unmount']) {
		const f = fixture(t);
		f.wheel();
		const initial = f.viewport;
		f.start();
		f.pointer('pointermove');
		if (reason === 'Escape') f.doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
		else if (reason === 'pointercancel') f.pointer('pointercancel');
		else if (reason === 'blur') f.view.dispatchEvent(new Event('blur'));
		else if (reason === 'window') f.changeWindow();
		else if (reason === 'suspend') f.state.renderEngine.isSuspended.value = true;
		else f.unmount();
		f.pointer('pointerup', { clientX: 999 });
		assert.deepEqual(f.viewport, initial, reason);
		assert.equal(f.flushes, 1, reason);
	}
});

// 【キーボードでも拡大・移動・全体表示へ戻せ、休止中の操作では変更しない】
// ホイールのない環境でも復帰手段を持ち、書き出しによる休止中は解析要求を増やさない。
test('supports keyboard navigation and ignores navigation while suspended', t => {
	const f = fixture(t);
	const key = key => f.plot.props.onKeydown({ key, preventDefault() {} });
	key('+');
	assert.ok(f.viewport.width < 1);
	const beforePan = f.viewport;
	key('ArrowRight');
	assert.ok(f.viewport.x > beforePan.x);
	key('Home');
	assert.equal(f.viewport.width, 1);
	f.state.renderEngine.isSuspended.value = true;
	f.wheel(); key('+');
	assert.deepEqual(f.viewport, { x: 0, y: 0, width: 1, height: 1 });
});

// 【ズームから導出した細い値域にも目盛りを表示し、元の範囲が無効な場合だけ空にする】
// 元のMin/MaxはGPUでfloat32として扱うが、表示窓は正規化した別の範囲なので二重に丸めない。
// 有効数字2桁のラベルが同じ値になっても両端の目盛りを残す。
test('keeps sub-float32 viewport labels while respecting an invalid base range', async t => {
	const f = fixture(t);
	f.state.displayedImageAnalysisSettings.value = { ...f.state.displayedImageAnalysisSettings.value, valueRange: { minimum: 1, maximum: 1.0000001 } };
	f.state.setWaveformViewport('horizontal', { x: 0.4, y: 0.5, width: 0.1, height: 0.1 });
	f.apply();
	await nextTick();
	assert.match(f.text(f.find('data-test-waveform-y-axis')), /^11+$/);
	f.state.displayedImageAnalysisSettings.value = { ...f.state.displayedImageAnalysisSettings.value, valueRange: { minimum: 1, maximum: 1 + Number.EPSILON } };
	await nextTick();
	assert.equal(f.text(f.find('data-test-waveform-y-axis')), '');
});
