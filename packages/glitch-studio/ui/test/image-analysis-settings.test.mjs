import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, ref } from 'vue';

const componentPath = new URL('../src/components/GsImageAnalysisSettings.vue', import.meta.url);
const descriptor = parse(await readFile(componentPath, 'utf8'), { filename: fileURLToPath(componentPath) }).descriptor;
const script = compileScript(descriptor, { id: 'image-analysis-settings', inlineTemplate: true, genDefaultAs: 'component' }).content;
const bundled = await build({
	stdin: { contents: `${script}\ncomponent.__cssModules = { $style: {} }; export default component;`, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'image-analysis-context', setup(build) {
		build.onResolve({ filter: /^@\/(app|ui)\.ts$/ }, args => ({ path: args.path, namespace: 'context' }));
		build.onLoad({ filter: /.*/, namespace: 'context' }, args => ({ contents: args.path.endsWith('app.ts')
			? 'export const appContext = dependencies.state;'
			: 'export const popupMenu = items => { dependencies.menu = items; };' }));
	} }],
});

function fixture(t) {
	const view = new EventTarget();
	const doc = new EventTarget();
	doc.defaultView = view;
	function element(tag) {
		let capture = null;
		const node = new EventTarget();
		return markRaw(Object.assign(node, { tag, props: {}, children: [], parent: null, text: '', ownerDocument: doc,
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
	const state = { analysisTarget: ref('rgb'), analysisValueScale: ref('srgb'), analysisRangePreset: ref('zeroToOne'), analysisCustomRange: ref({ minimum: 0, maximum: 1 }) };
	const dependencies = { menu: null, state };
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'dependencies', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, dependencies);
	const root = element('root');
	const app = renderer.createApp({ render: () => h(module.exports.default) });
	app.mount(root);
	let mounted = true;
	const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
	t.after(unmount);
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	const find = attribute => descendants(root).find(node => attribute in node.props);
	const text = node => node.text + node.children.map(text).join('');
	const pointer = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 7, clientX: 100, clientY: 100, ...props });
	return { state, doc, view, find, text, pointer, unmount,
		get menu() { return dependencies.menu; },
		openMenu(attribute) { find(attribute).props.onClick({ currentTarget: find(attribute) }); return dependencies.menu; },
		start(node) { node.props.onPointerdown({ currentTarget: node, pointerId: 7, button: 0, clientX: 100, clientY: 100, preventDefault() {} }); },
	};
}

// 【対象・変換方式・範囲は独立したメニューで選び、数値データの変換方式はLinearに限定する】
// 以前の範囲込みのモードへ戻らず、sRGB・EVでも同じ範囲を選べることを実際のボタンから確認する。
test('selects independent targets scales and the requested range presets', async t => {
	const f = fixture(t);
	const scales = f.openMenu('data-test-image-analysis-scale');
	assert.deepEqual(scales.map(item => item.text), ['sRGB', 'Linear', 'EV · 0 EV = 0.18']);
	for (const [index, scale] of ['srgb', 'linear', 'ev'].entries()) {
		scales[index].action();
		const ranges = f.openMenu('data-test-image-analysis-range');
		assert.deepEqual(ranges.map(item => item.text), ['0 ~ +1', '−1 ~ +1', '−1 ~ +4', '−0.5 ~ +0.5', '−10 ~ +10', 'Custom']);
		for (const [rangeIndex, preset] of ['zeroToOne', 'minusOneToOne', 'minusOneToFour', 'minusHalfToHalf', 'minusTenToTen', 'custom'].entries()) {
			ranges[rangeIndex].action();
			await nextTick();
			assert.equal(f.state.analysisRangePreset.value, preset);
			assert.equal(f.state.analysisValueScale.value, scale);
			assert.equal(f.find('data-test-image-analysis-min') != null, preset === 'custom');
			assert.equal(f.find('data-test-image-analysis-max') != null, preset === 'custom');
		}
	}
	const targets = f.openMenu('data-test-image-analysis-target');
	assert.deepEqual(targets.map(item => item.text), ['RGB', 'Alpha', 'Vector X', 'Vector Y', 'Vector Length']);
	for (const index of [1, 2, 3, 4, 0]) {
		targets[index].action();
		await nextTick();
		assert.deepEqual(f.openMenu('data-test-image-analysis-scale').map(item => item.text), index === 0 ? ['sRGB', 'Linear', 'EV · 0 EV = 0.18'] : ['Linear']);
		assert.equal(f.state.analysisRangePreset.value, 'custom');
	}
});

// 【CustomのMin・Maxは上下の累積移動で変更し、ドラッグ直後のclickだけを抑止する】
// pointerup時の値を残さないと、ドラッグで設定した範囲が直後に0へ戻ってしまう。
// その次の通常クリックは0へリセットし、もう片方の端点には影響しないことも確認する。
test('drags each custom endpoint vertically and resets it on a subsequent click', async t => {
	for (const [bound, attribute] of [['minimum', 'data-test-image-analysis-min'], ['maximum', 'data-test-image-analysis-max']]) {
		const f = fixture(t);
		f.state.analysisCustomRange.value = { minimum: -0.25, maximum: 0.75 };
		f.state.analysisRangePreset.value = 'custom';
		await nextTick();
		const node = f.find(attribute);
		const initial = f.state.analysisCustomRange.value[bound];
		f.start(node);
		f.doc.dispatchEvent(f.pointer('pointermove', { clientY: 70 }));
		f.doc.dispatchEvent(f.pointer('pointerup', { clientY: 60 }));
		node.props.onClick({ detail: 1 });
		assert.equal(f.state.analysisCustomRange.value[bound], Math.round((initial + 0.56) * 100) / 100);
		f.start(node);
		f.doc.dispatchEvent(f.pointer('pointermove', { clientY: 130 }));
		f.doc.dispatchEvent(f.pointer('pointerup', { clientY: 140 }));
		node.props.onClick({ detail: 1 });
		assert.equal(f.state.analysisCustomRange.value[bound], initial);
		f.start(node);
		f.doc.dispatchEvent(f.pointer('pointerup'));
		node.props.onClick({ detail: 1 });
		assert.equal(f.state.analysisCustomRange.value[bound], 0);
		const otherBound = bound === 'minimum' ? 'maximum' : 'minimum';
		assert.equal(f.state.analysisCustomRange.value[otherBound], otherBound === 'minimum' ? -0.25 : 0.75);
	}
});

// 【開始位置から離れるほどドラッグの感度を上げ、戻したときは同じ値へ戻す】
// 微調整と大きな範囲変更を両立しつつ、イベント数や移動経路によって加速が蓄積することを防ぐ。
// 等しい20pxの移動で変化が大きくなること、上下対称であること、途中経過を省いても一致することを確認する。
test('accelerates range dragging with distance while remaining symmetric and independent of the drag path', async t => {
	const f = fixture(t);
	f.state.analysisRangePreset.value = 'custom';
	await nextTick();
	const minimum = f.find('data-test-image-analysis-min');
	f.start(minimum);
	const values = [];
	for (const clientY of [80, 60, 40]) {
		f.doc.dispatchEvent(f.pointer('pointermove', { clientY }));
		values.push(f.state.analysisCustomRange.value.minimum);
	}
	assert.deepEqual(values, [0.24, 0.56, 0.96]);
	assert.ok(values[2] - values[1] > values[1] - values[0]);
	f.doc.dispatchEvent(f.pointer('pointermove', { clientY: 160 }));
	assert.equal(f.state.analysisCustomRange.value.minimum, -0.96);
	f.doc.dispatchEvent(f.pointer('pointermove', { clientY: 100 }));
	assert.equal(f.state.analysisCustomRange.value.minimum, 0);
	f.doc.dispatchEvent(f.pointer('pointerup', { clientY: 60 }));
	assert.equal(f.state.analysisCustomRange.value.minimum, 0.56);
	f.state.analysisCustomRange.value.minimum = 0;
	f.start(minimum);
	f.doc.dispatchEvent(f.pointer('pointerup', { clientY: 60 }));
	assert.equal(f.state.analysisCustomRange.value.minimum, 0.56);
});

// 【Esc・タッチのキャンセル・ウィンドウ移動・プリセット変更・破棄で未確定の範囲を復元する】
// 操作中のコントロールが消えた後も追跡を続けたり、取り消した数値を再適用したりしない。
test('restores a custom endpoint and stops tracking when a drag is cancelled', async t => {
	for (const reason of ['Escape', 'pointercancel', 'blur', 'preset', 'unmount']) {
		const f = fixture(t);
		f.state.analysisRangePreset.value = 'custom';
		await nextTick();
		f.start(f.find('data-test-image-analysis-max'));
		f.doc.dispatchEvent(f.pointer('pointermove', { clientY: 70 }));
		assert.equal(f.state.analysisCustomRange.value.maximum, 1.39);
		if (reason === 'Escape') f.doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
		else if (reason === 'preset') f.state.analysisRangePreset.value = 'zeroToOne';
		else if (reason === 'unmount') f.unmount();
		else if (reason === 'blur') f.view.dispatchEvent(new Event('blur'));
		else f.doc.dispatchEvent(f.pointer('pointercancel'));
		f.doc.dispatchEvent(f.pointer('pointerup', { clientY: 0 }));
		assert.equal(f.state.analysisCustomRange.value.maximum, 1, reason);
	}
});

// 【キー操作でも端点を調整でき、プリセットを往復してもCustomの値を保つ】
// ポインター以外でも同じ数値へ到達でき、Customを一時的に閉じただけで設定を失わない。
test('adjusts custom endpoints with the keyboard and retains them across presets', async t => {
	const f = fixture(t);
	f.state.analysisRangePreset.value = 'custom';
	await nextTick();
	const maximum = f.find('data-test-image-analysis-max');
	maximum.props.onKeydown({ key: 'ArrowUp', preventDefault() {} });
	assert.equal(f.state.analysisCustomRange.value.maximum, 1.01);
	f.state.analysisRangePreset.value = 'minusHalfToHalf';
	await nextTick();
	f.state.analysisRangePreset.value = 'custom';
	await nextTick();
	assert.ok(f.text(f.find('data-test-image-analysis-max')).includes('1.01'));
	f.find('data-test-image-analysis-max').props.onClick({ detail: 0 });
	assert.equal(f.state.analysisCustomRange.value.maximum, 0);
});
