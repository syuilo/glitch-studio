import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

// 両画面の実際のテンプレートを使い、共通コントロールとアプリの起動だけを置き換える。
// 子コントロールからの更新通知を通して、表示条件・倍率の保持・入力値の検証を確認する。
const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory,
	stdin: { contents: `
		export { default as NodeSettings } from './src/components/GsEffectNode.vue';
		export { default as LayerSettings } from './src/components/GsTimeline.EffectSettings.vue';
	`, resolveDir: directory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'effect-resolution-settings', setup(build) {
		build.onResolve({ filter: /^@\/app\.ts$/ }, () => ({ path: 'app', namespace: 'platform' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'platform' }));
		build.onResolve({ filter: /^@\/ui\.ts$/ }, () => ({ path: 'ui', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ contents: {
			app: 'export const appContext = { projectContext: { stateManager: { state: { resolution: { value: { width: 1920, height: 1080 } } } } } };',
			effects: "export const effectDefinitions = { test: { displayName: 'Test', paramDefs: {}, primaryOutput: 'output' } };",
			ui: 'export function alert() {}',
		}[path] }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsEffectNode\.vue$|GsTimeline\.EffectSettings\.vue$/.test(path)
			? null : { path: basename(path, '.vue'), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ contents: `
			import { h } from 'vue'; export default { inheritAttrs: false, setup(_, { attrs, slots }) {
				return () => h(${JSON.stringify(path)}, attrs, Object.values(slots).flatMap(slot => slot()));
			} };` }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: basename(path), inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}
				component.__cssModules = { $style: {} }; export default component;` };
		});
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { NodeSettings, LayerSettings } = module.exports;

const element = () => ({ children: [], parent: null, props: {}, style: {} });
const renderer = createRenderer({
	createElement: element, createText: element, createComment: element, setText() {}, setElementText() {},
	patchProp(element, key, _previous, value) { element.props[key] = value; },
	insert(element, parent, anchor = null) {
		if (element.parent != null) element.parent.children.splice(element.parent.children.indexOf(element), 1);
		parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, element);
		element.parent = parent;
	},
	remove(element) { element.parent.children.splice(element.parent.children.indexOf(element), 1); element.parent = null; },
	parentNode: element => element.parent,
	nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null,
});

async function fixture(t, target) {
	const owner = reactive({ id: 'effect', type: 'effect', effectId: 'test', resolution: { mode: 'auto', scale: 1 }, params: {}, isBypass: false });
	const changes = [];
	const change = resolution => { owner.resolution = resolution; changes.push(resolution); };
	const root = element();
	const app = renderer.createApp({ render: () => target === 'node'
		? h(NodeSettings, { node: owner, visualModule: { automationGraphs: [] }, onSetResolution: change })
		: h(LayerSettings, { layer: owner, contextResolution: { width: 1920, height: 1080 }, imageLayerOptions: [], anotherLayerAudioOptions: [], onResolution: change }) });
	app.mount(root);
	t.after(() => app.unmount());
	const find = attribute => {
		const visit = element => Object.hasOwn(element.props, attribute) ? element : element.children.map(visit).find(result => result != null) ?? null;
		return visit(root);
	};
	if (target === 'node') { find('data-test-node-settings').props.onClick(); await nextTick(); }
	const prefix = target === 'node' ? 'data-test-node' : 'data-test-effect-layer';
	return { owner, changes, scale: () => find(`${prefix}-resolution-scale`), mode: () => find(`${prefix}-resolution-mode`) };
}

for (const target of ['node', 'layer']) {
	// 【両画面で小数倍率を編集でき、不正値と同じ値の再通知を保存しない】
	// 解像度変更はリソースの再確保を伴うため、空入力・0・負数・非有限値で更新しない。
	test(`accepts positive fractional scales and ignores invalid or unchanged ${target} edits`, async t => {
		const f = await fixture(t, target);
		assert.equal(f.scale().props.modelValue, 1);
		assert.equal(f.scale().props.step, 'any');
		f.scale().props['onUpdate:modelValue'](0.375);
		await nextTick();
		assert.deepEqual(f.owner.resolution, { mode: 'auto', scale: 0.375 });
		assert.equal(f.scale().props.modelValue, 0.375);
		for (const value of [0.375, null, NaN, Infinity, 0, -1]) f.scale().props['onUpdate:modelValue'](value);
		assert.equal(f.changes.length, 1);
		f.owner.resolution = { mode: 'context', scale: 2.5 };
		await nextTick();
		assert.equal(f.scale().props.modelValue, 2.5);
		assert.equal(f.changes.length, 1);
	});

	// 【自動とコンテキストの切り替えでは倍率を保持し、絶対値では倍率欄を表示しない】
	// モードを変えるだけで編集済み倍率が失われたり、絶対値にも隠れた倍率が掛からないようにする。
	test(`preserves ${target} scales between relative modes and resets them after absolute dimensions`, async t => {
		const f = await fixture(t, target);
		f.scale().props['onUpdate:modelValue'](0.5);
		await nextTick();
		for (const mode of ['context', 'auto']) {
			f.mode().props['onUpdate:modelValue'](mode);
			await nextTick();
			assert.deepEqual(f.owner.resolution, { mode, scale: 0.5 });
		}
		f.mode().props['onUpdate:modelValue']('customAbsolute');
		await nextTick();
		assert.equal(f.scale(), null);
		assert.deepEqual(f.owner.resolution, { mode: 'customAbsolute', width: 1920, height: 1080 });
		f.mode().props['onUpdate:modelValue']('context');
		await nextTick();
		assert.deepEqual(f.owner.resolution, { mode: 'context', scale: 1 });
		assert.equal(f.scale().props.modelValue, 1);
	});
}
