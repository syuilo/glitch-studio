import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';
import { testNodesEffect } from './helpers/nodes-effect.mjs';

// 検索入力・フィルター・Enter選択を実際のテンプレート経由で操作する。
// アプリの初期化と子コントロールだけを置き換え、名前検索と入出力ポートの判定は実装を使用する。
const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory,
	stdin: { contents: `
		export { default as EffectPicker } from './src/components/GsEffectPicker.vue';
		export { nativeEffectDefinitions as fixtureDefinitions } from '@gs/subsystems_effect_native-effects/definitions.ts';
		export { state } from '@/project-session.ts';
	`, resolveDir: directory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'effect-picker-controls', setup(build) {
		build.onResolve({ filter: /^@\/(?:app|project-session)\.ts$/ }, () => ({ path: 'app', namespace: 'fixture' }));
		build.onResolve({ filter: /native-effects\/definitions\.ts$/ }, () => ({ path: 'effects', namespace: 'fixture' }));
		build.onResolve({ filter: /native-effects\/thumbnail-urls\.ts$/ }, () => ({ path: 'thumbnails', namespace: 'fixture' }));
		build.onLoad({ filter: /^thumbnails$/, namespace: 'fixture' }, () => ({
			contents: "export const getNativeEffectThumbnailUrl = id => id === 'withThumbnail' ? '/fixtures/thumbnail.webp' : null;",
		}));
		build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'app'
			? `import { ref } from 'vue';
				export const state = { customShaderEffects: ref([]), nodesEffects: ref([]) };
				export function useProjectSession() { return { projectContext: { stateManager: { state } } }; }`
			: "import { reactive } from 'vue'; export const nativeEffectDefinitions = reactive({});" }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsEffectPicker(?:\.Effect)?\.vue$/.test(path)
			? null : { path: basename(path, '.vue'), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ contents: `
			import { h } from 'vue';
			export default { inheritAttrs: false, setup(_, { attrs, slots, expose }) {
				expose({ close() {}, focus() {} });
				return () => h('control', attrs, Object.values(slots).flatMap(slot => slot()));
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
const { EffectPicker, fixtureDefinitions, state } = module.exports;

function effect(displayName, { kind = 'modify', inputType = 'color', outputType = 'color', primaryInput = true, primaryOutput = true, tags = ['noise'] } = {}) {
	return {
		displayName, kind, tags, summary: { 'ja-JP': '', 'en-US': '' },
		paramDefs: { input: { dataType: { kind: inputType }, canNode: true, ui: { label: 'Input' } } },
		outputDefs: { output: { dataType: { kind: outputType } } },
		primaryInputParameter: primaryInput ? 'input' : null,
		primaryOutput: primaryOutput ? 'output' : null,
	};
}

function fixture(t, definitions, { props = {}, graphs = [], shaders = [], recent = [] } = {}) {
	const storage = new Map([['glitch-studio:recent-effects', JSON.stringify(recent.map(source => JSON.stringify(source)))]]);
	const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		getItem: key => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, value),
	} });
	t.after(() => {
		if (previousStorage == null) delete globalThis.localStorage;
		else Object.defineProperty(globalThis, 'localStorage', previousStorage);
	});
	for (const key of Object.keys(fixtureDefinitions)) delete fixtureDefinitions[key];
	Object.assign(fixtureDefinitions, definitions);
	state.nodesEffects.value = graphs;
	state.customShaderEffects.value = shaders;
	const element = () => ({ children: [], parent: null, props: {} });
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
	const root = element();
	const chosen = [];
	const app = renderer.createApp({ render: () => h(EffectPicker, { ...props, onChosen: effect => chosen.push(effect) }) });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	const allElements = (element = root) => [element, ...element.children.flatMap(child => allElements(child))];
	const find = (attribute, value = null) => allElements().find(element => Object.hasOwn(element.props, attribute)
		&& (value == null || element.props[attribute] === value)) ?? null;
	return {
		chosen, find,
		thumbnails: () => allElements().filter(element => Object.hasOwn(element.props, 'data-test-effect-picker-thumbnail')),
		async search(query) {
			find('data-test-effect-picker-search').props['onUpdate:modelValue'](query);
			await nextTick();
		},
		async filter(attribute, value) {
			find(attribute, value).props.onClick();
			await nextTick();
		},
		results: () => allElements().filter(element => Object.hasOwn(element.props, 'data-test-effect-picker-effect'))
			.map(element => JSON.parse(element.props['data-test-effect-picker-effect']).id),
	};
}

// 【Native Effectのサムネイルは詳細カードに表示し、同じIDのNodes Effectや履歴には表示しない】
// 一覧と検索が同じカードを使う場合も、取得した画像を他の登録種別やコンパクト表示へ持ち込まないことを確かめる。
test('shows available native thumbnails in detailed cards across browsing and search', async t => {
	const f = fixture(t, { withThumbnail: effect('Previewed'), withoutThumbnail: effect('Plain') }, {
		graphs: [{ id: 'withThumbnail', name: 'Previewed graph', definition: testNodesEffect() }],
		recent: [{ type: 'nativeEffect', id: 'withThumbnail' }],
	});
	const thumbnails = () => f.thumbnails().map(({ props }) => [props.src, props.loading]);
	assert.deepEqual(thumbnails(), [['/fixtures/thumbnail.webp', 'lazy']]);
	await f.search('previewed');
	assert.deepEqual(thumbnails(), [['/fixtures/thumbnail.webp', 'lazy']]);
	await f.search('plain');
	assert.deepEqual(thumbnails(), []);
});

// 【検索欄の入力でAND・typo検索と順位を反映し、Enterで表示順の先頭を選択する】
// 純粋関数だけが正しくても、Pickerが元の登録順を使ったままでは誤ったエフェクトを選んでしまう。
// 空白だけの入力に戻したときも、検索結果ではなく初期のセクション表示へ戻す。
test('updates ranked results from the input and selects the first result with Enter', async t => {
	const f = fixture(t, { neuroNoise: effect('Neuro Noise'), noiseField: effect('Noise Field'), noise: effect('Noise'), blur: effect('Blur') });
	await f.search('　 \t');
	assert.equal(f.find('data-test-effect-picker-results'), null);
	for (const query of [' ＮＯＩＳＥ ', 'noi']) {
		await f.search(query);
		assert.deepEqual(f.results(), ['noise', 'noiseField', 'neuroNoise']);
	}
	f.find('data-test-effect-picker-search').props.onKeydown({ key: 'Enter', repeat: false, preventDefault() {}, stopPropagation() {} });
	assert.equal(f.chosen.length, 1);
	assert.equal(f.chosen[0].displayName, 'Noise');
	for (const query of ['noise neuro', 'neuro niose']) {
		await f.search(query);
		assert.deepEqual(f.results(), ['neuroNoise']);
	}
	await f.search('neuro noise blur');
	assert.deepEqual(f.results(), []);
	await f.search('　 ');
	assert.equal(f.find('data-test-effect-picker-results'), null);
});

// 【名前の一致度を型の優先順位より先に比較し、タグと型は厳密な絞り込みを保つ】
// any型を指定型の代わりに通したり、typo一致を完全一致より上にしたりしない。
// 検索未入力では従来どおり主入出力の一致数で並べ、同点では登録順を維持する。
test('applies strict filters and uses primary ports only to break equal name matches', async t => {
	const secondaryPorts = { primaryInput: false, primaryOutput: false };
	const f = fixture(t, {
		secondary: effect('Neuro Noise', secondaryPorts),
		primary: effect('Neuro Noise'),
		noise: effect('Noise', secondaryPorts),
		wrongTag: effect('Noise', { tags: ['blur'] }),
		wrongInput: effect('Noise', { inputType: 'any' }),
		wrongOutput: effect('Noise', { outputType: 'any' }),
		fuzzy: effect('Noize'),
	});
	await f.search('noise');
	await f.filter('data-test-effect-picker-input-type', 'color');
	await f.filter('data-test-effect-picker-output-type', 'color');
	await f.filter('data-test-effect-picker-tag', 'noise');
	assert.deepEqual(f.results(), ['noise', 'primary', 'secondary', 'fuzzy']);
	await f.search('');
	assert.deepEqual(f.results(), ['primary', 'fuzzy', 'secondary', 'noise']);
});

// 【エフェクトの種類は定義のkindで絞り込み、検索や他のフィルターと併用できる】
// 入力を持つ生成Effectも、登録種別やポート構成にかかわらず、定義どおりに表示されることを確かめる。
test('filters every Effect source by its declared kind and combines with other filters', async t => {
	const f = fixture(t, {
		addNoise: effect('Add Noise'),
		noise: effect('Noise', { kind: 'generate' }),
		scalarNoise: effect('Scalar Noise', { kind: 'generate', outputType: 'scalar' }),
		gradient: effect('Gradient', { kind: 'generate' }),
		grain: effect('Film Grain Noise', { kind: 'generate', tags: [] }),
	}, {
		graphs: [{ id: 'graph', name: 'Noise Graph', definition: testNodesEffect({ kind: 'modify' }) }],
		shaders: [{ id: 'shader', name: 'Shader', summary: '', definition: testNodesEffect({ kind: 'generate' }) }],
	});
	const selectKind = value => f.filter('data-test-effect-picker-kind', value);
	await selectKind('modify');
	assert.deepEqual(f.results(), ['addNoise', 'graph']);
	await selectKind('generate');
	assert.deepEqual(f.results(), ['noise', 'scalarNoise', 'gradient', 'grain', 'shader']);
	await selectKind('all');
	assert.equal(f.find('data-test-effect-picker-results'), null);
	assert.equal(f.results().length, 7);

	await selectKind('generate');
	await f.search('noise');
	await f.filter('data-test-effect-picker-output-type', 'color');
	await f.filter('data-test-effect-picker-tag', 'noise');
	assert.deepEqual(f.results(), ['noise']);
});

// 【グラフへの追加は自分自身と自分を含む候補だけを初期一覧・履歴・検索から除く】
// 登録種別が異なれば同じ ID を使える。未接続のインライングラフ経由の循環も除き、主出力のない子は選べる。
test('filters cyclic Nodes Effect references across sections, recents and search while keeping independent Effect sources', async t => {
	const reference = id => ({ type: 'nodesEffectReference', id });
	const node = effectSource => ({ id: 'node', effectSource, params: {}, isBypass: true });
	const parent = reference('shared');
	const child = reference('child');
	const ancestor = reference('ancestor');
	const native = { type: 'nativeEffect', id: 'shared' };
	const shader = { type: 'customShaderEffectReference', id: 'shared' };
	const f = fixture(t, { shared: effect('Native') }, {
		props: { parentNodesEffectId: parent.id }, recent: [ancestor, child, parent],
		shaders: [{ id: 'shared', name: 'Shader', summary: '', definition: testNodesEffect() }],
		graphs: [
			{ id: parent.id, name: 'Parent', definition: testNodesEffect() },
			{ id: child.id, name: 'Child Graph', definition: testNodesEffect({ primaryOutput: null }) },
			{ id: 'middle', name: 'Middle', definition: testNodesEffect({ nodes: [node(parent)] }) },
			{ id: ancestor.id, name: 'Ancestor Graph', definition: testNodesEffect({ nodes: [node({ type: 'inlineNodesEffect', nodesEffect: testNodesEffect({ nodes: [node(reference('middle'))] }) })] }) },
		],
	});
	const row = source => f.find('data-test-effect-picker-effect', JSON.stringify(source));
	assert.ok(row(native));
	assert.ok(row(shader));
	assert.ok(row(child));
	for (const source of [parent, ancestor, reference('middle')]) assert.equal(row(source), null);
	assert.equal(f.find('data-test-recent-effect', JSON.stringify(ancestor)), null);
	assert.ok(f.find('data-test-recent-effect', JSON.stringify(child)));
	await f.search('Graph');
	assert.deepEqual(f.results(), [child.id]);
	row(child).props.onClick();
	assert.deepEqual(f.chosen[0].effectSource, child);
	state.nodesEffects.value.find(entry => entry.id === 'middle').definition.nodes = [];
	await nextTick();
	assert.ok(row(ancestor));
});

// 【Timeline のレイヤーには主出力が color の登録グラフだけを表示する】
// 副出力に color があってもレイヤーはそれを自動選択しない。型フィルターを解除しても配置条件を維持する。
test('offers registered Nodes Effects with a primary color output for timeline layers', async t => {
	const outputDefs = { color: { dataType: { kind: 'color' } }, scalar: { dataType: { kind: 'scalar' } } };
	const f = fixture(t, {}, {
		props: { selectedOutputType: 'color', requirePrimaryColorOutput: true },
		graphs: ['color', 'scalar', null].map(primaryOutput => ({
			id: primaryOutput ?? 'none', name: 'Graph', definition: testNodesEffect({ primaryOutput, outputDefs }),
		})),
	});
	assert.deepEqual(f.results(), ['color']);
	await f.filter('data-test-effect-picker-output-type', 'all');
	assert.deepEqual(f.results(), ['color']);
});
