import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

// 表示の切り替えには実際のSFCテンプレートを使う。子の入力・スライダーだけを
// 最小の要素に置き換え、CSSやポップアップから独立して要素の寿命を検証する。
const directory = fileURLToPath(new URL('../src/components/common/', import.meta.url));
const { descriptor } = parse(await readFile(new URL('../src/components/common/GsAngle.vue', import.meta.url), 'utf8'));
const bundled = await build({
	stdin: { contents: compileScript(descriptor, { id: 'angle-input-test', inlineTemplate: true }).content, loader: 'ts', resolveDir: directory },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'angle-test-dependencies', setup(build) {
		build.onResolve({ filter: /\.vue$|^@\// }, args => ({ path: args.path, namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path.endsWith('GsInput.vue')
			? `import { h } from 'vue'; export default {
				props: ['modelValue'], emits: ['update:modelValue'],
				setup(props, { emit }) { return () => h('input', {
					value: props.modelValue, onInput: event => emit('update:modelValue', Number(event.target.value)),
				}); },
			}`
			: "import { h } from 'vue'; export default { render: () => h('div') }; export const i18n = {};" }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const Angle = module.exports.default;
Angle.__cssModules = { $style: {} };

const element = () => ({ children: [], props: {}, parent: null });
const renderer = createRenderer({
	createElement: element, createText: element, createComment: element,
	setText() {}, setElementText() {},
	patchProp(element, key, _previous, value) { element.props[key] = value; },
	insert(element, parent, anchor = null) {
		parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, element);
		element.parent = parent;
	},
	remove(element) {
		element.parent.children.splice(element.parent.children.indexOf(element), 1);
		element.parent = null;
	},
	parentNode: element => element.parent,
	nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null,
	querySelector: element,
});

function fixture(t, modelValue) {
	const props = reactive({ modelValue });
	const events = [];
	const root = element();
	const app = renderer.createApp({ render: () => h(Angle, {
		...props,
		'onUpdate:modelValue': value => { props.modelValue = value; events.push(['value', value]); },
		onBeginChanging: () => events.push(['begin']),
		onChangeFinished: () => events.push(['finish']),
	}) });
	app.mount(root);
	t.after(() => app.unmount());
	const find = attribute => {
		const visit = element => Object.hasOwn(element.props, attribute) ? element : element.children.map(visit).find(value => value != null) ?? null;
		return visit(root);
	};
	return { props, events, input: () => find('data-test-angle-number-input'), slider: () => find('data-test-angle-slider') };
}

// 【複数周の角度を打ち直しても、フォーカスが外れるまで入力欄を破棄しない】
// 最初の1桁が±180°以内に入るたびにスライダーへ切り替えると、720°などを
// 最後まで入力できない。正負の角度と、範囲内で確定した後の切り替えを確認する。
test('keeps the numeric input mounted while typing across the slider range', async t => {
	for (const direction of [1, -1]) {
		const state = fixture(t, direction * 2);
		const input = state.input();
		assert.equal(input.props.value, direction * 720);
		input.props.onFocusin();
		for (const degrees of [7, 72, 720, 9, 90].map(value => direction * value)) {
			input.props.onInput({ target: { value: String(degrees) } });
			await nextTick();
			assert.equal(state.input(), input);
			assert.equal(state.slider(), null);
			assert.equal(state.props.modelValue, degrees / 360);
		}
		assert.deepEqual(state.events.filter(([type]) => type !== 'value'), [['begin']]);
		input.props.onFocusout();
		await nextTick();
		assert.equal(state.input(), null);
		assert.notEqual(state.slider(), null);
		assert.deepEqual(state.events.filter(([type]) => type !== 'value'), [['begin'], ['finish']]);
	}
});

// 【外部同期は編集として通知せず、入力中の表示方式も維持する】
// Undo/Redoなどで範囲内の値が届いたときも入力欄の寿命を保ち、フォーカスが
// 外れた後は新しい値に合うコントロールを表示する。複数周の値は折り返さない。
test('synchronizes external turns without emitting edits or replacing a focused input', async t => {
	const state = fixture(t, 0);
	assert.notEqual(state.slider(), null);
	state.props.modelValue = 3;
	await nextTick();
	const input = state.input();
	assert.equal(input.props.value, 1080);
	assert.deepEqual(state.events, []);
	input.props.onFocusin();
	state.props.modelValue = 0.25;
	await nextTick();
	assert.equal(state.input(), input);
	assert.equal(input.props.value, 90);
	assert.deepEqual(state.events, [['begin']]);
	input.props.onFocusout();
	await nextTick();
	assert.equal(state.input(), null);
	assert.notEqual(state.slider(), null);
	assert.deepEqual(state.events, [['begin'], ['finish']]);
});
