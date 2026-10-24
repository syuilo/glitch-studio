import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue';
import { createDefaultColorRamp } from '@gs/shared/color-ramp.ts';
import { i18nPlugin } from './helpers/i18n.mjs';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
function evaluate(bundle) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const commands = evaluate(await build({
	absWorkingDir: uiDirectory,
	stdin: { resolveDir: uiDirectory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
		export { default as definition } from '@gs/subsystems_effect_shared/fx/colorRamp/_def_.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [i18nPlugin, { name: 'color-ramp-command-platform', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path.includes('preferences') ? 'preferences' : 'effects', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', resolveDir: uiDirectory, contents: path === 'preferences'
			? 'export const preferences = { s: { forceTypeSafety: true } };'
			: "import definition from '@gs/subsystems_effect_shared/fx/colorRamp/_def_.ts'; export const effectDefinitions = { colorRamp: definition };" }));
	} }],
}));

// 【ランプ編集を一つのUndoへまとめ、式・加工式・保存でも対応表を維持する】
// 個別stopをCommandの対象へ追加せず、既存の末端値編集で実際の履歴とMessagePack保存を往復する。
test('preserves Color Ramp values and modifiers through merged edits, undo, redo and saving', async () => {
	const { definition, COMMAND_DEFS, UndoRedo, encodeProjectFile, decodeProjectFile } = commands;
	const node = { id: 'node', type: 'effect', effectId: 'colorRamp', params: Object.fromEntries(Object.entries(definition.paramDefs).map(([name, def]) => [name, structuredClone(def.defaultValue)])) };
	const visualModule = { id: 'visual-module', nodes: [node] };
	const state = { visualModules: { value: [visualModule] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const target = { visualModuleId: visualModule.id, nodeId: node.id, paramPath: ['ramp'] };
	const initial = structuredClone(node.params.ramp);
	const ramp = createDefaultColorRamp();
	ramp.stops.push({ id: 'middle', position: 0.5, color: [1, 0, 0, 0.5] });
	history.commit('updateParamAsLiteral', { ...target, value: ramp }, 'drag');
	ramp.stops[2].position = 0.75;
	history.commit('updateParamAsLiteral', { ...target, value: ramp }, 'drag');
	assert.equal(history.undoStack.value.length, 1);
	history.undo();
	assert.deepEqual(node.params.ramp, initial);
	history.redo();
	assert.equal(node.params.ramp.value.stops[2].position, 0.75);
	const modifier = { enabled: true, code: 'VALUE.colorSpace = "oklab"\nVALUE' };
	history.commit('updateParamExpressionModifier', { ...target, value: modifier });
	history.commit('changeParamValueInputSource', { ...target, inputSource: 'expression' });
	assert.match(node.params.ramp.expression, /middle/);
	assert.deepEqual(node.params.ramp.expressionModifier, modifier);
	const encoded = await encodeProjectFile({ assets: [], generatedSpeech: [], timelineScenes: [], visualModules: state.visualModules.value, gsVersion: '2.0.0-alpha.19' });
	assert.deepEqual(decodeProjectFile(encoded).visualModules[0].nodes[0].params, node.params);
	assert.throws(() => history.commit('changeParamValueInputSource', { ...target, inputSource: 'automationGraphInline' }), /does not support/);
});

const componentDirectory = fileURLToPath(new URL('../src/components/common/', import.meta.url));
async function buildComponent(name) {
	const { descriptor } = parse(await readFile(new URL(`../src/components/common/${name}.vue`, import.meta.url), 'utf8'));
	const componentBundle = await build({
		stdin: { contents: compileScript(descriptor, { id: name, inlineTemplate: true }).content, loader: 'ts', resolveDir: componentDirectory },
		bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
		plugins: [i18nPlugin, { name: 'color-ramp-controls', setup(build) {
			build.onResolve({ filter: /^@\/utility\// }, args => ({ path: fileURLToPath(new URL(`../src/utility/${args.path.split('/').at(-1)}`, import.meta.url)) }));
			build.onResolve({ filter: /\.vue$/ }, args => ({ path: args.path, namespace: 'control' }));
			build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ contents: path.endsWith('GsColorRampEditor.vue') ? `
				import { h } from 'vue'; export default {
					props: ['modelValue', 'anchorElement', 'title'], emits: ['update:modelValue', 'closing', 'closed'],
					setup(props, { emit }) { return () => h('div', {
						'data-test-color-ramp-editor-stub': '', value: props.modelValue, anchorElement: props.anchorElement, title: props.title,
						onInput: value => emit('update:modelValue', value), onClosing: () => emit('closing'), onClosed: () => emit('closed'),
					}); },
				};
			` : path.endsWith('GsModal.vue') ? `
				import { h } from 'vue'; export default {
					props: ['anchorElement', 'zPriority', 'transparentBg'], emits: ['click', 'esc', 'close', 'closed'],
					setup(props, { emit, expose, slots }) {
						expose({ close() { emit('close'); emit('closed'); } });
						return () => h('div', { 'data-test-color-ramp-modal': '', onBackdrop: () => emit('click'), onEscape: () => emit('esc') }, slots.default());
					},
				};
			` : `import { h } from 'vue'; export default {
				props: ['modelValue', 'items', 'disabled'], emits: ['update:modelValue', 'click', 'beginChanging', 'changeFinished'],
				setup(props, { emit, attrs }) { return () => h('div', { ...attrs, value: props.modelValue, disabled: props.disabled,
					onInput: value => emit('update:modelValue', value), onClick: () => emit('click'),
				}); },
			};` }));
		} }],
	});
	const component = evaluate(componentBundle);
	component.default.__cssModules = { $style: {} };
	return component;
}
const { default: ColorRampEditor } = await buildComponent('GsColorRampEditor');
const { default: ColorRampInput } = await buildComponent('GsColorRampInput');
const element = () => markRaw({ children: [], props: {}, parent: null, focusCount: 0, focus() { this.focusCount++; } });
const createTestRenderer = teleportTarget => createRenderer({
	createElement: element, createText: element, createComment: element, setText() {}, setElementText() {},
	querySelector: () => teleportTarget,
	patchProp(element, key, _previous, value) { element.props[key] = value; },
	insert(element, parent, anchor = null) { parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, element); element.parent = parent; },
	remove(element) { element.parent.children.splice(element.parent.children.indexOf(element), 1); element.parent = null; },
	parentNode: element => element.parent, nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null,
});
async function fixture(t, component = ColorRampEditor) {
	const state = reactive({ modelValue: createDefaultColorRamp() });
	const events = [];
	const root = element();
	const teleportTarget = element();
	const renderer = createTestRenderer(teleportTarget);
	const app = renderer.createApp({ render: () => h(component, { ...state, anchorElement: root, title: 'Ramp',
		'onUpdate:modelValue': value => { state.modelValue = value; events.push('value'); },
		onBeginChanging: () => events.push('begin'), onChangeFinished: () => events.push('finish'),
		onClosing: () => events.push('closing'), onClosed: () => events.push('closed'),
	}) });
	app.directive('tooltip', {});
	app.mount(root);
	let mounted = true;
	const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
	t.after(unmount);
	const findAll = attribute => {
		const visit = element => [...(Object.hasOwn(element.props, attribute) ? [element] : []), ...element.children.flatMap(visit)];
		return [...visit(root), ...visit(teleportTarget)];
	};
	const find = attribute => findAll(attribute)[0];
	await nextTick();
	return { state, events, find, findAll, unmount };
}

// 【ストップを選択するだけでは値を変えず、掴んだ位置からの移動量でドラッグする】
// ハンドルの中心以外を押しても、移動のないpointerupで位置や履歴を変更しない。
// 同じ押下位置からドラッグした場合も、最初のクリック位置へ飛ばず移動距離だけを反映する。
test('preserves stop positions on selection and drags relative to the grabbed position', async t => {
	const { state, events, find, findAll } = await fixture(t);
	const track = find('data-test-color-ramp-track');
	track.getBoundingClientRect = () => ({ left: 100, width: 200 });
	const stop = findAll('data-test-color-ramp-stop')[0];
	const ownerWindow = new EventTarget();
	const pointerTarget = new EventTarget();
	const captures = new Set();
	Object.assign(stop, {
		ownerDocument: { defaultView: ownerWindow },
		addEventListener: pointerTarget.addEventListener.bind(pointerTarget),
		removeEventListener: pointerTarget.removeEventListener.bind(pointerTarget),
		setPointerCapture: id => captures.add(id),
		hasPointerCapture: id => captures.has(id),
		releasePointerCapture: id => captures.delete(id),
	});
	const press = () => stop.props.onPointerdown({ button: 0, pointerId: 1, clientX: 105, currentTarget: stop, stopPropagation() {}, preventDefault() {} });
	const dispatch = (type, clientX) => ownerWindow.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX }));
	press();
	dispatch('pointerup', 105);
	await nextTick();
	assert.equal(state.modelValue.stops[0].position, 0);
	assert.deepEqual(events, []);
	press();
	dispatch('pointermove', 155);
	await nextTick();
	assert.equal(state.modelValue.stops[0].position, 0.25);
	dispatch('pointerup', 155);
	await nextTick();
	assert.equal(state.modelValue.stops[0].position, 0.25);
	assert.deepEqual(events, ['value']);
	assert.equal(captures.size, 0);
});

// 【追加色を現在の補間色で初期化し、交差・削除後もIDで選択する】
// 実際のSFCテンプレートを使い、クラス名に依存せずstopの選択・数値編集・最後のstop保護を確認する。
test('edits stable stop IDs and initializes inserted colors from the current ramp', async t => {
	const { state, find, findAll } = await fixture(t);
	find('data-test-color-ramp-add').props.onClick();
	await nextTick();
	assert.equal(state.modelValue.stops.length, 3);
	assert.deepEqual(Array.from(state.modelValue.stops[2].color), [0.5, 0.5, 0.5, 1]);
	const id = state.modelValue.stops[2].id;
	const position = find('data-test-color-ramp-position');
	position.props.onInput(0.9);
	await nextTick();
	position.props.onInput(1.5);
	await nextTick();
	assert.equal(state.modelValue.stops.find(stop => stop.id === id).position, 1);
	findAll('data-test-color-ramp-stop').find(element => element.props['data-stop-id'] === id).props.onKeydown({ key: 'ArrowLeft', shiftKey: true, preventDefault() {} });
	await nextTick();
	assert.equal(state.modelValue.stops.find(stop => stop.id === id).position, 0.9);
	find('data-test-color-ramp-remove').props.onClick();
	await nextTick();
	assert.equal(state.modelValue.stops.some(stop => stop.id === id), false);
	find('data-test-color-ramp-remove').props.onClick();
	await nextTick();
	assert.equal(find('data-test-color-ramp-remove').props.disabled, true);
	assert.equal(state.modelValue.stops.length, 1);
});

// 【外部のUndoやランプの交換は編集イベントにせず、失われた選択を修復する】
// 同じコントロールへ別の保存値が届いても、削除済みstopの色入力を残さず新しい値を表示する。
test('synchronizes replacement ramps and selects an existing stop without emitting edits', async t => {
	const { state, events, find } = await fixture(t);
	state.modelValue = { colorSpace: 'oklab', interpolation: 'constant', stops: [{ id: 'replacement', position: 0.4, color: [1, 0, 0, 1] }] };
	await nextTick();
	assert.equal(find('data-test-color-ramp-selection').props.value, 'replacement');
	assert.equal(find('data-test-color-ramp-position').props.value, 0.4);
	assert.deepEqual(events, []);
});

// 【プレビューから開いたポップアップの編集を、閉じるまで一つの履歴へまとめる】
// レイアウト内には編集欄を作らず、外部のUndoも開いているポップアップへ同期する。
// 閉じるアニメーション中の遅延通知や二重起動で、編集履歴が再開されないことも確認する。
test('opens an anchored popup and groups its edits until closing', async t => {
	const { state, events, find } = await fixture(t, ColorRampInput);
	const preview = find('data-test-color-ramp-toggle');
	assert.equal(find('data-test-color-ramp-editor-stub'), undefined);
	preview.props.onKeydown[0]({ key: 'Enter', preventDefault() {} });
	preview.props.onClick();
	await nextTick();
	const editor = find('data-test-color-ramp-editor-stub');
	assert.equal(editor.props.anchorElement, preview);
	assert.equal(editor.props.title, 'Ramp');
	assert.equal(find('data-test-color-ramp-toggle').children.includes(editor), false);
	assert.deepEqual(events, []);
	editor.props.onInput({ ...state.modelValue, interpolation: 'constant' });
	await nextTick();
	editor.props.onInput({ ...state.modelValue, colorSpace: 'oklab' });
	await nextTick();
	assert.deepEqual(events, ['begin', 'value', 'value']);
	state.modelValue = createDefaultColorRamp();
	await nextTick();
	assert.equal(editor.props.value, state.modelValue);
	editor.props.onClosing();
	editor.props.onInput({ ...state.modelValue, colorSpace: 'linearSrgb' });
	preview.props.onClick();
	await nextTick();
	assert.deepEqual(events, ['begin', 'value', 'value', 'finish']);
	assert.equal(state.modelValue.colorSpace, 'srgb');
	assert.equal(find('data-test-color-ramp-editor-stub'), editor);
	editor.props.onClosed();
	editor.props.onClosed();
	await nextTick();
	assert.equal(find('data-test-color-ramp-editor-stub'), undefined);
	assert.equal(preview.focusCount, 1);
	preview.props.onClick();
	await nextTick();
	assert.notEqual(find('data-test-color-ramp-editor-stub'), editor);
	find('data-test-color-ramp-editor-stub').props.onClosed();
	assert.deepEqual(events, ['begin', 'value', 'value', 'finish']);
});

// 【入力元の破棄時にもポップアップと編集中の履歴を確定する】
// Inspectorの選択切替で残ったポップアップが、別の対象へ古い値を書き込むことを防ぐ。
test('disposes the popup on unmount and ignores late updates', async t => {
	const { state, events, find, unmount } = await fixture(t, ColorRampInput);
	const preview = find('data-test-color-ramp-toggle');
	preview.props.onClick();
	await nextTick();
	const editor = find('data-test-color-ramp-editor-stub');
	editor.props.onInput({ ...state.modelValue, colorSpace: 'oklab' });
	unmount();
	assert.equal(find('data-test-color-ramp-editor-stub'), undefined);
	assert.deepEqual(events, ['begin', 'value', 'finish']);
	editor.props.onInput(createDefaultColorRamp());
	editor.props.onClosing();
	editor.props.onClosed();
	assert.deepEqual(events, ['begin', 'value', 'finish']);
	assert.equal(state.modelValue.colorSpace, 'oklab');
	assert.equal(preview.focusCount, 0);
});

// 【閉じるボタン・背景クリック・Escapeは共通Modalの終了処理を通す】
// IME変換中のEscapeはランプ編集全体を閉じず、日本語入力の取消しに使えるようにする。
test('closes through the modal controls and preserves IME composition', async t => {
	for (const action of ['button', 'backdrop', 'escape', 'modalEscape']) {
		const { events, find, unmount } = await fixture(t);
		const editor = find('data-test-color-ramp-editor');
		editor.props.onKeydown({ key: 'Escape', isComposing: true, stopPropagation() {}, preventDefault() {} });
		assert.deepEqual(events, []);
		if (action === 'button') find('data-test-color-ramp-close').props.onClick();
		if (action === 'backdrop') find('data-test-color-ramp-modal').props.onBackdrop();
		if (action === 'escape') editor.props.onKeydown({ key: 'Escape', isComposing: false, stopPropagation() {}, preventDefault() {} });
		if (action === 'modalEscape') find('data-test-color-ramp-modal').props.onEscape();
		assert.deepEqual(events, ['closing', 'closed']);
		unmount();
	}
});
