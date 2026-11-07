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

// 検索入力・フィルター・Enter選択を実際のテンプレート経由で操作する。
// アプリの初期化と子コントロールだけを置き換え、名前検索と入出力ポートの判定は実装を使用する。
const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory,
	stdin: { contents: `
		export { default as EffectPicker } from './src/components/GsEffectPicker.vue';
		export { fixtureDefinitions } from './src/utility/project-effects.ts';
	`, resolveDir: directory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'effect-picker-controls', setup(build) {
		build.onResolve({ filter: /^@\/app\.ts$/ }, () => ({ path: 'app', namespace: 'fixture' }));
		build.onResolve({ filter: /project-effects\.ts$/ }, () => ({ path: 'effects', namespace: 'fixture' }));
		build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'app'
			? 'export const appContext = { projectContext: { stateManager: { state: {} } } };'
			: `import { reactive } from 'vue';
				export const fixtureDefinitions = reactive({});
				export function getEffectDefinitions() { return fixtureDefinitions; }` }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => path.endsWith('GsEffectPicker.vue')
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
const { EffectPicker, fixtureDefinitions } = module.exports;

function effect(displayName, { inputType = 'color', outputType = 'color', primaryInput = true, primaryOutput = true, tags = ['noise'] } = {}) {
	return {
		displayName, tags,
		paramDefs: { input: { dataType: { kind: inputType }, canNode: true, ui: { label: 'Input' } } },
		outputDefs: { output: { dataType: { kind: outputType } } },
		primaryInputParameter: primaryInput ? 'input' : null,
		primaryOutput: primaryOutput ? 'output' : null,
	};
}

function fixture(t, definitions) {
	const storage = new Map();
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
	const app = renderer.createApp({ render: () => h(EffectPicker, { onChosen: effect => chosen.push(effect) }) });
	app.mount(root);
	t.after(() => app.unmount());
	const allElements = (element = root) => [element, ...element.children.flatMap(child => allElements(child))];
	const find = (attribute, value = null) => allElements().find(element => Object.hasOwn(element.props, attribute)
		&& (value == null || element.props[attribute] === value)) ?? null;
	return {
		chosen, find,
		async search(query) {
			find('data-test-effect-picker-search').props['onUpdate:modelValue'](query);
			await nextTick();
		},
		async filter(attribute, value) {
			find(attribute, value).props.onClick();
			await nextTick();
		},
		results: () => allElements().filter(element => Object.hasOwn(element.props, 'data-test-effect-picker-effect'))
			.map(element => element.props['data-test-effect-picker-effect']),
	};
}

// 【検索欄の入力でAND・typo検索と順位を反映し、Enterで表示順の先頭を選択する】
// 純粋関数だけが正しくても、Pickerが元の登録順を使ったままでは誤ったエフェクトを選んでしまう。
// 空白だけの入力に戻したときも、検索結果ではなく初期のセクション表示へ戻す。
test('updates ranked results from the input and selects the first result with Enter', async t => {
	const f = fixture(t, { neuroNoise: effect('Neuro Noise'), noise: effect('Noise'), blur: effect('Blur') });
	await f.search('　 \t');
	assert.equal(f.find('data-test-effect-picker-results'), null);
	await f.search(' ＮＯＩＳＥ ');
	assert.deepEqual(f.results(), ['noise', 'neuroNoise']);
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
