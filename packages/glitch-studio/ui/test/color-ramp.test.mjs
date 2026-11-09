import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue';
import { createDefaultColorRamp } from '@gs/shared/color-ramp.ts';
import { COLOR_RAMP_PRESETS } from '../src/color-ramp-presets.ts';
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
	const node = { id: 'node', type: 'effect', effectId: 'colorRamp', resolution: { mode: 'context', scale: 1 }, staticSettings: {}, params: Object.fromEntries(Object.entries(definition.paramDefs).map(([name, def]) => [name, structuredClone(def.defaultValue)])) };
	const visualModule = { customParameterDefs: [], customParameterValues: {}, id: 'visual-module', nodes: [node], paramDefs: [] };
	const state = { visualModules: { value: [visualModule] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const target = { visualModuleId: visualModule.id, nodeId: node.id, paramPath: ['ramp'] };
	const initial = structuredClone(node.params.ramp);
	const ramp = createDefaultColorRamp();
	ramp.colorSpace = 'oklch';
	ramp.hueInterpolation = 'decreasing';
	ramp.interpolation = 'smootherstep';
	ramp.stops.push({ id: 'middle', position: 0.5, color: [1, 0, 0, 0.5] });
	history.commit('updateParamAsLiteral', { ...target, value: ramp }, 'drag');
	ramp.stops[2].position = 0.75;
	ramp.interpolation = 'easeOut';
	history.commit('updateParamAsLiteral', { ...target, value: ramp }, 'drag');
	assert.equal(history.undoStack.value.length, 1);
	history.undo();
	assert.deepEqual(node.params.ramp, initial);
	history.redo();
	assert.equal(node.params.ramp.value.stops[2].position, 0.75);
	assert.equal(node.params.ramp.value.colorSpace, 'oklch');
	assert.equal(node.params.ramp.value.hueInterpolation, 'decreasing');
	assert.equal(node.params.ramp.value.interpolation, 'easeOut');
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
			build.onResolve({ filter: /^@\// }, args => ({ path: fileURLToPath(new URL(`../src/${args.path.slice(2)}`, import.meta.url)) }));
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
				props: ['modelValue', 'items', 'disabled', 'ramp'], emits: ['update:modelValue', 'click', 'beginChanging', 'changeFinished'],
				setup(props, { emit, attrs, slots }) { return () => h('div', { ...attrs, value: props.modelValue, items: props.items, disabled: props.disabled, ramp: props.ramp,
					onInput: value => emit('update:modelValue', value), onClick: () => emit('click'),
				}, slots.default?.()); },
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

function createStopDrag({ find, findAll }, id) {
	const track = find('data-test-color-ramp-track');
	track.getBoundingClientRect = () => ({ left: 100, width: 200 });
	const stop = findAll('data-test-color-ramp-stop').find(element => element.props['data-stop-id'] === id);
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
	return {
		stop, captures,
		press: () => stop.props.onPointerdown({ button: 0, pointerId: 1, clientX: 105, clientY: 100, currentTarget: stop, stopPropagation() {}, preventDefault() {} }),
		dispatch: (type, clientX, clientY = 100) => ownerWindow.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX, clientY })),
	};
}

// 【追加した補間方法を選び、stop追加時も表示中の補間色を使う】
// 選択肢への追加だけでなく、モデル更新から追加色の評価まで同じ設定が届くことを確認する。
test('inserts stops using the selected smootherstep or quadratic interpolation', async t => {
	const { state, find } = await fixture(t);
	for (const [interpolation, expected] of [['smootherstep', 0.103515625], ['easeIn', 0.0625], ['easeOut', 0.4375]]) {
		state.modelValue = createDefaultColorRamp();
		await nextTick();
		const control = find('data-test-color-ramp-interpolation');
		assert.ok(control.props.items.some(item => item.value === interpolation));
		control.props.onInput(interpolation);
		await nextTick();
		assert.equal(state.modelValue.interpolation, interpolation);
		const track = find('data-test-color-ramp-track');
		track.getBoundingClientRect = () => ({ left: 100, width: 200 });
		track.props.onDblclick({ clientX: 150 });
		await nextTick();
		assert.deepEqual(Array.from(state.modelValue.stops[2].color), [expected, expected, expected, 1]);
	}
});

// 【OKLCHの選択時だけ色相経路を表示し、色空間の切替でもRGBAと経路を保持する】
// 設定の切替で保存色を再変換せず、式が経路を省略した場合も既定のShorterを表示する。
test('edits OKLCH hue interpolation without rewriting stop colors', async t => {
	const { state, find } = await fixture(t);
	const originalStops = structuredClone(createDefaultColorRamp().stops);
	const colorSpace = find('data-test-color-ramp-color-space');
	assert.ok(colorSpace.props.items.some(item => item.value === 'oklch'));
	assert.equal(find('data-test-color-ramp-hue-interpolation'), undefined);
	colorSpace.props.onInput('oklch');
	await nextTick();
	const hueInterpolation = find('data-test-color-ramp-hue-interpolation');
	assert.equal(hueInterpolation.props.value, 'shorter');
	assert.deepEqual(Array.from(hueInterpolation.props.items, item => item.value), ['shorter', 'longer', 'increasing', 'decreasing']);
	hueInterpolation.props.onInput('increasing');
	await nextTick();
	assert.equal(state.modelValue.hueInterpolation, 'increasing');
	colorSpace.props.onInput('oklab');
	await nextTick();
	assert.equal(find('data-test-color-ramp-hue-interpolation'), undefined);
	colorSpace.props.onInput('oklch');
	await nextTick();
	assert.equal(find('data-test-color-ramp-hue-interpolation').props.value, 'increasing');
	assert.deepEqual(JSON.parse(JSON.stringify(state.modelValue.stops)), originalStops);
});

// 【プリセットの適用は補間設定を維持し、配色を共有しない新しいstopへ置き換える】
// 適用後の色編集が組み込み定義へ漏れると、別のランプでもプリセットの結果が変わってしまう。
// 同じプリセットの再適用で元の色と透明度を復元でき、IDと選択も新しいstopへ移ることを確認する。
test('applies independent preset stops while preserving interpolation settings', async t => {
	const { state, events, find, findAll } = await fixture(t);
	state.modelValue = { ...state.modelValue, interpolation: 'smootherstep', colorSpace: 'oklch', hueInterpolation: 'decreasing' };
	await nextTick();
	const originalStopIds = state.modelValue.stops.map(stop => stop.id);
	const preset = COLOR_RAMP_PRESETS.find(preset => preset.id === 'white-alpha-pulse');
	const button = findAll('data-test-color-ramp-preset').find(element => element.props['data-preset-id'] === preset.id);
	const stopValues = () => state.modelValue.stops.map(stop => ({ position: stop.position, color: Array.from(stop.color) }));
	button.props.onClick();
	await nextTick();
	assert.deepEqual(stopValues(), preset.stops);
	assert.equal(state.modelValue.interpolation, 'smootherstep');
	assert.equal(state.modelValue.colorSpace, 'oklch');
	assert.equal(state.modelValue.hueInterpolation, 'decreasing');
	assert.equal(new Set(state.modelValue.stops.map(stop => stop.id)).size, preset.stops.length);
	assert.ok(state.modelValue.stops.every(stop => !originalStopIds.includes(stop.id)));
	assert.equal(find('data-test-color-ramp-position').props.value, state.modelValue.stops[0].position);
	const firstAppliedStopIds = state.modelValue.stops.map(stop => stop.id);
	state.modelValue.stops[0].color[0] = 0.25;
	button.props.onClick();
	await nextTick();
	assert.deepEqual(stopValues(), preset.stops);
	assert.ok(state.modelValue.stops.every(stop => !firstAppliedStopIds.includes(stop.id)));
	assert.equal(find('data-test-color-ramp-position').props.value, state.modelValue.stops[0].position);
	assert.deepEqual(events, ['value', 'value']);
});

// 【プリセット一覧は現在の補間設定を使い、stop編集だけでは再描画しない】
// 一覧と適用結果で見た目が変わらないように色空間とOKLCHの経路も同期する。
// stopドラッグ中に多数のcanvasを毎回更新すると編集が重くなるため、プレビューの参照を維持する。
test('updates all preset previews only when interpolation settings change', async t => {
	const { find, findAll } = await fixture(t);
	assert.deepEqual(findAll('data-test-color-ramp-preset').map(element => element.props['data-preset-id']), COLOR_RAMP_PRESETS.map(preset => preset.id));
	find('data-test-color-ramp-interpolation').props.onInput('constant');
	await nextTick();
	find('data-test-color-ramp-color-space').props.onInput('oklch');
	await nextTick();
	find('data-test-color-ramp-hue-interpolation').props.onInput('longer');
	await nextTick();
	const previews = findAll('data-test-color-ramp-preset-preview').map(element => element.props.ramp);
	assert.equal(previews.length, COLOR_RAMP_PRESETS.length);
	for (const [index, ramp] of previews.entries()) {
		assert.equal(ramp.interpolation, 'constant');
		assert.equal(ramp.colorSpace, 'oklch');
		assert.equal(ramp.hueInterpolation, 'longer');
		assert.deepEqual(ramp.stops.map(stop => ({ position: stop.position, color: Array.from(stop.color) })), COLOR_RAMP_PRESETS[index].stops);
	}
	find('data-test-color-ramp-position').props.onInput(0.2);
	await nextTick();
	for (const [index, element] of findAll('data-test-color-ramp-preset-preview').entries()) {
		assert.equal(element.props.ramp, previews[index]);
	}
});

// 【ストップを選択するだけでは値を変えず、掴んだ位置からの移動量でドラッグする】
// ハンドルの中心以外を押しても、移動のないpointerupで位置や履歴を変更しない。
// 同じ押下位置からドラッグした場合も、最初のクリック位置へ飛ばず移動距離だけを反映する。
test('preserves stop positions on selection and drags relative to the grabbed position', async t => {
	const editor = await fixture(t);
	const { state, events } = editor;
	const { press, dispatch, captures } = createStopDrag(editor, state.modelValue.stops[0].id);
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

// 【上下へ離して削除しても追跡を続け、戻すと同じストップを元の保存順へ復元する】
// モデルからの削除でCapture先や選択まで失うと、押したまま戻す操作ができなくなる。
// 境界の往復・透明度・横移動も確認し、復元で別IDや別色のストップへ化けることを防ぐ。
test('restores temporarily removed stops while preserving capture, identity and save order', async t => {
	const editor = await fixture(t);
	const { state, events, find, findAll } = editor;
	const middle = { id: 'middle', position: 0.25, color: [1, 0.25, 0, 0.4] };
	state.modelValue.stops.splice(1, 0, middle);
	await nextTick();
	const { stop, press, dispatch, captures } = createStopDrag(editor, middle.id);
	press();
	dispatch('pointermove', 155, 139);
	await nextTick();
	assert.equal(state.modelValue.stops.length, 3);
	assert.equal(state.modelValue.stops[1].position, 0.5);
	dispatch('pointermove', 155, 140);
	await nextTick();
	assert.deepEqual(state.modelValue.stops.map(stop => stop.id), ['start', 'end']);
	assert.equal(stop.props.style.visibility, 'hidden');
	assert.equal(captures.size, 1);
	const removalEventCount = events.length;
	dispatch('pointermove', 205, 180);
	await nextTick();
	assert.equal(events.length, removalEventCount);
	dispatch('pointermove', 205, 61);
	await nextTick();
	assert.deepEqual(state.modelValue.stops.map(stop => stop.id), ['start', 'middle', 'end']);
	assert.deepEqual(Array.from(state.modelValue.stops[1].color), middle.color);
	assert.equal(state.modelValue.stops[1].position, 0.75);
	assert.equal(find('data-test-color-ramp-position').props.value, 0.75);
	assert.equal(findAll('data-test-color-ramp-stop')[1], stop);
	assert.notEqual(stop.props.style.visibility, 'hidden');
	dispatch('pointermove', 205, 60);
	await nextTick();
	assert.equal(state.modelValue.stops.length, 2);
	dispatch('pointerup', 155, 100);
	await nextTick();
	assert.deepEqual(state.modelValue.stops.map(stop => stop.id), ['start', 'middle', 'end']);
	assert.equal(state.modelValue.stops[1].position, 0.5);
	assert.equal(find('data-test-color-ramp-position').props.value, 0.5);
	assert.equal(captures.size, 0);
});

// 【上下どちらへ離しても削除を確定し、その後の移動で復元しない】
// pointerup後まで追跡が残ると、別の操作で削除済みのストップを復元してしまう。
// 位置欄も残っているストップへ切り替え、削除済みの値を編集し続けないようにする。
test('commits stop removal on release above or below the drag origin', async t => {
	for (const clientY of [60, 140]) {
		const editor = await fixture(t);
		const { state, events, find, findAll } = editor;
		const { press, dispatch, captures } = createStopDrag(editor, 'start');
		press();
		dispatch('pointermove', 105, clientY);
		await nextTick();
		dispatch('pointerup', 105, clientY);
		await nextTick();
		assert.deepEqual(state.modelValue.stops.map(stop => stop.id), ['end']);
		assert.deepEqual(findAll('data-test-color-ramp-stop').map(element => element.props['data-stop-id']), ['end']);
		assert.equal(find('data-test-color-ramp-position').props.value, 1);
		assert.equal(captures.size, 0);
		dispatch('pointermove', 105, 100);
		await nextTick();
		assert.deepEqual(events, ['value']);
	}
});

// 【最後のストップは上下へ離しても残し、横方向の編集を継続する】
// 空のColor Rampは無効なため、ドラッグ削除にもキーボード削除と同じ制約を適用する。
test('keeps the final stop while dragging outside the removal range', async t => {
	const editor = await fixture(t);
	const { state } = editor;
	state.modelValue.stops = [{ id: 'only', position: 0.25, color: [1, 0, 0, 1] }];
	await nextTick();
	const { press, dispatch, captures } = createStopDrag(editor, 'only');
	press();
	dispatch('pointermove', 155, 200);
	await nextTick();
	dispatch('pointerup', 155, 200);
	await nextTick();
	assert.equal(state.modelValue.stops.length, 1);
	assert.equal(state.modelValue.stops[0].position, 0.5);
	assert.equal(captures.size, 0);
});

// 【一時削除中のキャンセル・フォーカス喪失・外部置換で追跡を終了する】
// 終了後の移動で古いストップを復元したり、置換済みのランプへ混入させたりしない。
test('cleans up temporary removal when capture ends or the ramp is replaced', async t => {
	for (const ending of ['pointercancel', 'blur', 'replacement']) {
		const editor = await fixture(t);
		const { state, events, findAll } = editor;
		const { press, dispatch, captures } = createStopDrag(editor, 'start');
		press();
		dispatch('pointermove', 105, 140);
		await nextTick();
		if (ending === 'replacement') {
			state.modelValue = { ...createDefaultColorRamp(), stops: [{ id: 'replacement', position: 0.4, color: [1, 0, 0, 1] }] };
		} else {
			dispatch(ending, 105, 140);
		}
		await nextTick();
		const expectedIds = ending === 'replacement' ? ['replacement'] : ['end'];
		assert.deepEqual(findAll('data-test-color-ramp-stop').map(element => element.props['data-stop-id']), expectedIds);
		assert.equal(captures.size, 0);
		dispatch('pointermove', 105, 100);
		await nextTick();
		assert.deepEqual(state.modelValue.stops.map(stop => stop.id), expectedIds);
		assert.deepEqual(events, ['value']);
	}
});

// 【追加色を現在の補間色で初期化し、交差・削除後もIDで選択する】
// 実際のSFCテンプレートを使い、クラス名に依存せずstopの選択・数値編集・最後のstop保護を確認する。
test('edits stable stop IDs and initializes inserted colors from the current ramp', async t => {
	const { state, find, findAll } = await fixture(t);
	const track = find('data-test-color-ramp-track');
	track.getBoundingClientRect = () => ({ left: 100, width: 200 });
	track.props.onDblclick({ clientX: 200 });
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
	findAll('data-test-color-ramp-stop').find(element => element.props['data-stop-id'] === id).props.onKeydown({ key: 'Delete', preventDefault() {} });
	await nextTick();
	assert.equal(state.modelValue.stops.some(stop => stop.id === id), false);
	findAll('data-test-color-ramp-stop')[0].props.onKeydown({ key: 'Delete', preventDefault() {} });
	await nextTick();
	assert.equal(state.modelValue.stops.length, 1);
	findAll('data-test-color-ramp-stop')[0].props.onKeydown({ key: 'Delete', preventDefault() {} });
	await nextTick();
	assert.equal(state.modelValue.stops.length, 1);
});

// 【外部のUndoやランプの交換は編集イベントにせず、失われた選択を修復する】
// 同じコントロールへ別の保存値が届いても、削除済みstopの色入力を残さず新しい値を表示する。
test('synchronizes replacement ramps and selects an existing stop without emitting edits', async t => {
	const { state, events, find } = await fixture(t);
	state.modelValue = { colorSpace: 'oklab', interpolation: 'constant', stops: [{ id: 'replacement', position: 0.4, color: [1, 0, 0, 1] }] };
	await nextTick();
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
	editor.props.onInput({ ...state.modelValue, colorSpace: 'srgb' });
	preview.props.onClick();
	await nextTick();
	assert.deepEqual(events, ['begin', 'value', 'value', 'finish']);
	assert.equal(state.modelValue.colorSpace, 'linearSrgb');
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
