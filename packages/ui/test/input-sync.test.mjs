import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

// 入力の同期処理は実際のSFCを使い、DOMやポップアップへの依存だけ置き換える。
const source = await readFile(new URL('../src/components/common/GsInput.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const script = compileScript(descriptor, { id: 'input-sync-test' });
const bundled = await build({
	stdin: { contents: script.content, loader: 'ts', resolveDir: import.meta.dirname },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	external: ['vue', 'throttle-debounce'],
	plugins: [{
		name: 'input-test-dependencies',
		setup(build) {
			build.onResolve({ filter: /^@/ }, args => ({ path: args.path, namespace: 'stub' }));
			build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
				contents: 'export default {}; export const genId = () => "test"; export const i18n = {}; export class Autocomplete {}',
			}));
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const Input = { ...module.exports.default, render: () => null };
const renderer = createRenderer({
	createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null,
});

function fixture(t, options = {}) {
	const previousObserver = globalThis.ResizeObserver;
	globalThis.ResizeObserver = class { observe() {} disconnect() {} };
	const props = reactive({ modelValue: 'before', ...options });
	const edits = [];
	let input;
	const app = renderer.createApp({
		render: () => h(Input, {
			...props,
			ref: instance => { if (instance) input = instance.$.setupState; },
			'onUpdate:modelValue': value => { edits.push(value); props.modelValue = value; },
		}),
	});
	app.mount({});
	t.after(() => { app.unmount(); globalThis.ResizeObserver = previousObserver; });
	return { props, edits, input };
}

// Undo/Redoで戻した値が新しい編集として通知されると、Redo履歴が失われる。
test('does not emit edits when synchronizing undo and redo values', async t => {
	const { props, edits, input } = fixture(t);
	input.v = 'after';
	await nextTick();
	assert.deepEqual(edits, ['after']);
	props.modelValue = 'before';
	await nextTick();
	assert.equal(input.v, 'before');
	assert.deepEqual(edits, ['after']);
	props.modelValue = 'after';
	await nextTick();
	assert.equal(input.v, 'after');
	assert.deepEqual(edits, ['after']);
	input.v = 'next edit';
	await nextTick();
	assert.deepEqual(edits, ['after', 'next edit']);
});

// 外部同期で待機中の通知を取り消しても、その後のユーザー編集は通知できる。
test('cancels pending debounced edits and allows subsequent edits', async t => {
	const { props, edits, input } = fixture(t, { debounce: 10 });
	input.v = 'pending';
	await nextTick();
	props.modelValue = 'external';
	await nextTick();
	await new Promise(resolve => setTimeout(resolve, 30));
	assert.deepEqual(edits, []);
	assert.equal(input.v, 'external');
	input.v = 'next edit';
	await nextTick();
	await new Promise(resolve => setTimeout(resolve, 30));
	assert.deepEqual(edits, ['next edit']);
});
