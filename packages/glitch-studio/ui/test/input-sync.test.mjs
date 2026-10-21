import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

// 入力の同期処理は実際のSFCを使い、DOMやポップアップへの依存だけ置き換える。
async function loadInputComponent(fileName) {
	const source = await readFile(new URL(`../src/components/common/${fileName}`, import.meta.url), 'utf8');
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
	return { ...module.exports.default, render: () => null };
}
const [Input, Textarea] = await Promise.all([loadInputComponent('GsInput.vue'), loadInputComponent('GsTextarea.vue')]);
const renderer = createRenderer({
	createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null,
});

function fixture(t, options = {}, component = Input) {
	const previousObserver = globalThis.ResizeObserver;
	globalThis.ResizeObserver = class { observe() {} disconnect() {} };
	const props = reactive({ modelValue: 'before', ...options });
	const edits = [];
	let input;
	const app = renderer.createApp({
		render: () => h(component, {
			...props,
			ref: instance => { if (instance) input = instance.$.setupState; },
			'onUpdate:modelValue': value => { edits.push(value); props.modelValue = value; },
		}),
	});
	app.mount({});
	t.after(() => { app.unmount(); globalThis.ResizeObserver = previousObserver; });
	return { props, edits, input };
}

// 【Undo/Redoによる同期を新しい編集として通知しない】
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

// 【外部同期では遅延通知を取り消し、その後の編集は受け付ける】
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

function keyEvent(key, options = {}) {
	return { key, code: key === 'Enter' ? 'Enter' : 'KeyS', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
		repeat: false, isComposing: false, keyCode: 0, defaultPrevented: false, propagationStopped: false,
		preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...options };
}

for (const [name, component] of [['GsInput', Input], ['GsTextarea', Textarea]]) {
	// 【手動保存の入力途中や通常のEnterでは親の値を変更せず、明示保存だけで通知する】
	// 未完成の式をプロジェクトへ反映しないことと、保存後の外部同期を再編集として通知しないことを守る。
	test(`keeps manual-save drafts local until a button save or save shortcut in ${name}`, async t => {
		const { props, edits, input } = fixture(t, { manualSave: true }, component);
		input.v = 'unfinished +';
		await nextTick();
		input.onKeydown(keyEvent('Enter'));
		assert.deepEqual(edits, []);
		assert.equal(props.modelValue, 'before');
		input.v = 'complete';
		input.updated();
		await nextTick();
		assert.deepEqual(edits, ['complete']);
		for (const options of [{ key: 'Enter', ctrlKey: true }, { key: 's', ctrlKey: true }, { key: 'Enter', metaKey: true }, { key: 's', metaKey: true }]) {
			input.v = JSON.stringify(options);
			await nextTick();
			const event = keyEvent(options.key, options);
			input.onKeydown(event);
			await nextTick();
			assert.equal(edits.at(-1), JSON.stringify(options));
			assert.equal(event.defaultPrevented, true);
			assert.equal(event.propagationStopped, true);
		}
	});

	// 【IME変換の確定やキーの押しっぱなしでは未保存の入力を適用しない】
	// 日本語入力を確定するEnterを式の適用と取り違えたり、同じ保存を繰り返したりしない。
	test(`ignores composing and repeated save shortcuts in ${name}`, async t => {
		const { edits, input } = fixture(t, { manualSave: true }, component);
		input.v = 'draft';
		await nextTick();
		for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
			input.onKeydown(keyEvent('Enter', { ctrlKey: true, ...options }));
		}
		input.onKeydown(keyEvent('Escape', { isComposing: true }));
		input.onKeydown(keyEvent('Escape', { keyCode: 229 }));
		assert.equal(input.v, 'draft');
		assert.deepEqual(edits, []);
	});

	// 【外部から確定値が変わった場合は古いドラフトと未保存表示を破棄する】
	// Undo/Redo後に古い本文を保存し直して、履歴やレンダラーの状態を巻き戻さない。
	test(`discards manual-save drafts and dirty state when the applied value changes in ${name}`, async t => {
		const { props, edits, input } = fixture(t, { manualSave: true }, component);
		input.v = 'unsaved draft';
		input.changed = true;
		await nextTick();
		props.modelValue = 'external';
		await nextTick();
		assert.equal(input.v, 'external');
		assert.equal(input.changed, false);
		input.updated();
		assert.deepEqual(edits, []);
	});

	// 【キャンセルボタンとEscは最後に適用された値へ戻し、適用済みの編集は取り消さない】
	// ドラフト破棄でCommandを発行するとUndo履歴やプレビューまで巻き戻るため、ローカルの入力だけを戻す。
	// 外部で適用された最新値と、保存した直後の値の両方を復元先として確認する。
	test(`cancels drafts locally using the button action and Escape in ${name}`, async t => {
		const { props, edits, input } = fixture(t, { manualSave: true }, component);
		props.modelValue = 'externally applied';
		await nextTick();
		input.v = 'discard this draft';
		await nextTick();
		assert.equal(input.changed, true);
		input.cancelEditing();
		await nextTick();
		assert.equal(input.v, 'externally applied');
		assert.equal(input.changed, false);
		assert.deepEqual(edits, []);
		input.v = 'saved';
		input.updated();
		await nextTick();
		input.v = 'discard the next draft';
		await nextTick();
		const escape = keyEvent('Escape');
		input.onKeydown(escape);
		await nextTick();
		assert.equal(input.v, 'saved');
		assert.equal(input.changed, false);
		assert.deepEqual(edits, ['saved']);
		assert.equal(escape.defaultPrevented, true);
		assert.equal(escape.propagationStopped, true);
		const idleEscape = keyEvent('Escape');
		input.onKeydown(idleEscape);
		assert.equal(idleEscape.defaultPrevented, false);
		assert.equal(idleEscape.propagationStopped, false);
	});

	// 【元の文字列まで入力で戻した場合は未保存の変更として扱わない】
	// 変更がないのに保存・キャンセルのボタンが残ったり、Escを親画面へ渡せなくなったりしない。
	test(`clears dirty state when typing back to the applied value in ${name}`, async t => {
		const { props, edits, input } = fixture(t, { manualSave: true }, component);
		input.v = 'draft';
		await nextTick();
		assert.equal(input.changed, true);
		input.v = props.modelValue;
		await nextTick();
		assert.equal(input.changed, false);
		assert.deepEqual(edits, []);
	});

	// 【未選択のnullをキャンセルで空文字の編集として保存しない】
	// 表示上は空でも、親が保持している未選択状態を取り消し操作で変更してはいけない。
	test(`preserves an unselected null value when cancelling in ${name}`, async t => {
		const { props, edits, input } = fixture(t, { modelValue: null, manualSave: true }, component);
		input.v = 'draft';
		await nextTick();
		input.cancelEditing();
		await nextTick();
		assert.equal(input.changed, false);
		assert.equal(props.modelValue, null);
		input.updated();
		assert.deepEqual(edits, []);
	});
}

// 【Textareaの外部同期を新しい編集として返さない】
// Undo/Redoの値を返送すると履歴を破壊する一方、その後の通常の編集は引き続き反映する必要がある。
test('does not echo externally applied textarea values and accepts subsequent edits', async t => {
	const { props, edits, input } = fixture(t, {}, Textarea);
	input.v = 'edited';
	await nextTick();
	assert.deepEqual(edits, ['edited']);
	props.modelValue = 'external';
	await nextTick();
	assert.equal(input.v, 'external');
	assert.deepEqual(edits, ['edited']);
	input.v = 'next edit';
	await nextTick();
	assert.deepEqual(edits, ['edited', 'next edit']);
});

// 【コード用TextareaのTab挿入も保存待ちの編集として取り消せる】
// inputイベントなしで挿入したタブが未保存表示やキャンセルの対象から漏れないようにする。
test('marks a textarea Tab insertion as dirty and cancels it without applying', async t => {
	const { edits, input } = fixture(t, { modelValue: '', manualSave: true, code: true }, Textarea);
	const tab = keyEvent('Tab', { code: 'Tab' });
	input.onKeydown(tab);
	await nextTick();
	assert.equal(input.v, '\t');
	assert.equal(input.changed, true);
	assert.equal(tab.defaultPrevented, true);
	assert.deepEqual(edits, []);
	input.cancelEditing();
	await nextTick();
	assert.equal(input.v, '');
	assert.equal(input.changed, false);
});
