import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, shallowRef } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const path = fileURLToPath(new URL('../src/components/GsRenderingStats.vue', import.meta.url));
const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
const script = compileScript(descriptor, { id: 'rendering-stats-test', inlineTemplate: true, genDefaultAs: 'component' }).content;
const bundle = await build({ stdin: { contents: `${script}
	component.__cssModules = { $style: {} }; export default component;`, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [i18nPlugin, { name: 'statistics-context', setup(build) {
		build.onResolve({ filter: /^@\/(?:app|preferences)\.ts$/ }, args => ({ path: args.path, namespace: 'statistics-context' }));
		build.onLoad({ filter: /.*/, namespace: 'statistics-context' }, args => ({ contents: args.path.endsWith('preferences.ts')
			? 'export const preferences = dependencies.preferences;' : 'export const appContext = dependencies.appContext;' }));
	} }],
});

async function fixture(t, { enabled = true } = {}) {
	const renderingStatsEnabled = shallowRef(enabled);
	const statistics = shallowRef(null);
	const state = shallowRef({ mode: 'timeline', playing: false });
	const appContext = { previewPlayback: { state }, timelineRendererManagerController: { previewStatistics: statistics },
		visualModuleRendererManagerController: { gpuAverageDisplayFast: shallowRef(1500), gpuAverageDisplayMedium: shallowRef(2500), gpuAverageDisplaySlow: shallowRef(3500) } };
	let timestamp = 0;
	let tick = null;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'dependencies', 'window', 'ResizeObserver', 'performance', bundle.outputFiles[0].text)(
		createRequire(import.meta.url), module, module.exports, { appContext, preferences: { r: { renderingStatsEnabled } } },
		{ setInterval(callback) { tick = callback; return 1; }, clearInterval() { tick = null; } },
		class { observe() {} disconnect() {} }, { now: () => timestamp });
	const element = tag => ({ tag, children: [], props: {}, style: {}, text: '', parent: null });
	const renderer = createRenderer({
		createElement: element, createText: text => ({ ...element('text'), text }), createComment: () => element('comment'),
		setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
		patchProp(node, key, _previous, value) { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const root = element('container');
	const app = renderer.createApp({ render: () => h(module.exports.default) });
	app.mount(root);
	t.after(() => app.unmount());
	await nextTick();
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	return { statistics, state, app, renderingStatsEnabled,
		statistic: key => descendants(root).find(node => node.props['data-test-rendering-stat'] === key),
		line: key => descendants(root).find(node => node.props['data-test-rendering-stat-line'] === key),
		async sample() { timestamp += 100; tick?.(); await nextTick(); },
		get timerActive() { return tick != null; },
	};
}

// 【計測無効時はUIの定期サンプリングも止め、再開時に古い履歴を残さない】
// Workerを無効にしてもパネルが周期的に時計とグラフを更新すると負荷が残る。
// Timelineは通知、Live Previewは有効時だけのタイマーで更新することを確認する。
test('stops sampling and clears displayed values when measurement is disabled', async t => {
	const f = await fixture(t, { enabled: false });
	assert.equal(f.timerActive, false);
	f.state.value = { mode: 'visualModuleLivePreview', playing: true };
	await nextTick();
	assert.equal(f.timerActive, false);
	assert.deepEqual(values(f.statistic('fast')), ['—']);
	f.renderingStatsEnabled.value = true;
	await nextTick();
	assert.equal(f.timerActive, true);
	assert.deepEqual(values(f.statistic('fast')), ['1.5ms']);
	f.renderingStatsEnabled.value = false;
	await nextTick();
	assert.equal(f.timerActive, false);
	assert.deepEqual(values(f.statistic('fast')), ['—']);
	assert.equal(f.line('fast').props.points, '');
});

function values(node) {
	return node.children.filter(child => 'data-test-rendering-stat-average' in child.props || 'data-test-rendering-stat-maximum' in child.props).map(child => child.text);
}

// 【Timelineの平均と最大値をmsのまま表示し、未計測や停止中の値を新しいサンプルにしない】
// Visual Moduleの統計は別の単位で渡されるため、共通の単位変換を通すとTimelineが1000分の1になる。
// 待機中は0と断定せず未計測表示とし、一時停止中の重複通知で履歴を埋めない。
test('displays timeline averages and maxima in milliseconds without duplicating idle samples', async t => {
	const f = await fixture(t);
	assert.deepEqual(values(f.statistic('frameDurationMs')), ['—', '(—)']);
	f.statistics.value = { sceneId: 'scene', revision: 0, frameCount: 2,
		average: { frameDurationMs: 20, videoSampleWaitMs: 10, videoUploadCpuMs: 2, gpuWaitMs: 5 },
		maximum: { frameDurationMs: 24, videoSampleWaitMs: 14, videoUploadCpuMs: 3, gpuWaitMs: 6 } };
	await f.sample();
	assert.deepEqual(values(f.statistic('frameDurationMs')), ['20.0ms', '(24.0ms)']);
	assert.deepEqual(values(f.statistic('videoSampleWaitMs')), ['10.0ms', '(14.0ms)']);
	assert.deepEqual(values(f.statistic('videoUploadCpuMs')), ['2.0ms', '(3.0ms)']);
	assert.deepEqual(values(f.statistic('gpuWaitMs')), ['5.0ms', '(6.0ms)']);
	const points = f.line('frameDurationMs').props.points;
	await f.sample();
	assert.equal(f.line('frameDurationMs').props.points, points);
	f.statistics.value = null;
	await f.sample();
	assert.deepEqual(values(f.statistic('frameDurationMs')), ['—', '(—)']);
	assert.equal(f.line('frameDurationMs').props.points, '');
});

// 【プレビュー表示を切り替えたら異なる指標の履歴を混ぜず、従来のGPU移動平均も維持する】
// 同じパネルを両モードで使うため、切り替え後に動画の待ち時間をGPUの値として描かない。
// アンマウント後にサンプリングタイマーが残らないことも確認する。
test('switches between timeline timings and Visual Module GPU averages with separate histories', async t => {
	const f = await fixture(t);
	f.state.value = { mode: 'visualModuleLivePreview', playing: true };
	await nextTick();
	assert.equal(f.statistic('frameDurationMs'), undefined);
	assert.deepEqual(values(f.statistic('fast')), ['1.5ms']);
	assert.deepEqual(values(f.statistic('medium')), ['2.5ms']);
	assert.deepEqual(values(f.statistic('slow')), ['3.5ms']);
	await f.sample();
	assert.equal(f.line('fast').props.points.split(' ').length, 2);
	f.state.value = { mode: 'timeline', playing: false };
	await nextTick();
	assert.equal(f.statistic('fast'), undefined);
	assert.equal(f.line('frameDurationMs').props.points, '');
	f.app.unmount();
	assert.equal(f.timerActive, false);
});
