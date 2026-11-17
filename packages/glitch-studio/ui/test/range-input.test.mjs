import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

// 実際のSFCとPointer Captureの共通処理を使い、ポップアップ・DOM描画だけを切り離す。
const { descriptor } = parse(await readFile(new URL('../src/components/common/GsRange.vue', import.meta.url), 'utf8'));
const bundled = await build({
	stdin: { contents: compileScript(descriptor, { id: 'range-input-test' }).content, loader: 'ts', resolveDir: import.meta.dirname },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'range-test-dependencies', setup(build) {
		build.onResolve({ filter: /^@\/utility\/pointer-drag\.ts$/ }, () => ({
			path: fileURLToPath(new URL('../src/utility/pointer-drag.ts', import.meta.url)),
		}));
		// 数式は本番と同じ評価処理を使い、パーサーやインタープリターを置き換えない。
		build.onResolve({ filter: /^@\/utility\/numeric-input-expression\.ts$/ }, () => ({
			path: fileURLToPath(new URL('../src/utility/numeric-input-expression.ts', import.meta.url)),
		}));
		build.onResolve({ filter: /^@\/|^@gs\// }, args => ({ path: args.path, namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
			contents: 'export default {}; export const genId = () => "test"; export const claimZIndex = () => 3000100;',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const Range = { ...module.exports.default, render: () => null };
const renderer = createRenderer({
	createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null,
});

function fixture(t, options = {}, controlWidth = 200) {
	const props = reactive({ modelValue: 50, min: 0, max: 100, ...options });
	const events = [];
	let input;
	const app = renderer.createApp({ render: () => h(Range, {
		...props,
		ref: instance => { if (instance != null) input = instance.$.setupState; },
		'onUpdate:modelValue': value => { events.push(['value', value]); props.modelValue = value; },
		onBeginChanging: () => events.push(['begin']),
		onChangeFinished: () => events.push(['finish']),
		onDragEnded: value => events.push(['dragEnded', value]),
	}) });
	app.mount({});
	let mounted = true;
	const unmount = () => {
		if (!mounted) return;
		mounted = false;
		app.unmount();
	};
	t.after(unmount);
	const ownerWindow = new EventTarget();
	const captures = new Set();
	const layout = { width: controlWidth };
	const element = Object.assign(new EventTarget(), {
		ownerDocument: { defaultView: ownerWindow },
		getBoundingClientRect: () => ({ width: layout.width }),
		setPointerCapture: pointerId => captures.add(pointerId),
		hasPointerCapture: pointerId => captures.has(pointerId),
		releasePointerCapture: pointerId => captures.delete(pointerId),
	});
	const pointer = (clientX, options = {}) => ({
		clientX, clientY: 0, pointerId: 1, button: 0, isPrimary: true, shiftKey: false,
		currentTarget: element, preventDefault() {}, stopPropagation() {}, ...options,
	});
	const send = (type, clientX, options) => {
		const { currentTarget, ...properties } = pointer(clientX, options);
		return ownerWindow.dispatchEvent(Object.assign(new Event(type), properties));
	};
	return { props, events, input, unmount, captures, ownerWindow, layout,
		down: (clientX, options) => input.onPointerdown(pointer(clientX, options)),
		move: (clientX, options) => send('pointermove', clientX, options),
		up: (clientX, options) => send('pointerup', clientX, options),
		cancel: () => send('pointercancel', 0),
	};
}

function keyEvent(key, options = {}) {
	return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false,
		preventDefault() {}, stopPropagation() {}, ...options };
}

// 【左右ドラッグで増減し、縦移動や押しただけの操作では値を変えない】
// 通知をドラッグの開始・終了で囲み、continuousUpdate時の確定値を重複通知しない。
test('adjusts horizontally and groups continuous edits without duplicate updates', async t => {
	const state = fixture(t, { continuousUpdate: true });
	state.down(200);
	state.move(200, { clientY: 300 });
	assert.deepEqual(state.events, [['begin']]);
	state.move(220);
	await nextTick();
	assert.equal(state.props.modelValue, 60);
	state.up(180);
	await nextTick();
	assert.equal(state.props.modelValue, 40);
	assert.deepEqual(state.events, [['begin'], ['value', 60], ['value', 40], ['dragEnded', 40], ['finish']]);
	assert.equal(state.captures.size, 0);
	state.move(300);
	assert.equal(state.input.value, 40);
});

// 【帯の長さの変化を入力欄の実幅に応じてポインターの移動距離へ揃える】
// 固定の操作距離では、パネル幅によって帯が速すぎたり遅すぎたりする。
// 線形・対数の両方で通常操作は等距離、Shift操作は1/10とし、次のドラッグでは変更後の幅を使う。
test('matches fill movement to pointer distance across control widths and scales', async t => {
	for (const width of [160, 320, 640.5]) {
		for (const logarithmic of [false, true]) {
			const state = fixture(t, {
				modelValue: logarithmic ? 1 : 25, min: logarithmic ? 0.01 : 0, max: 100,
				step: 0, logarithmic,
			}, width);
			const initialFillWidth = state.input.valueRatio * width;
			state.down(50);
			state.move(74);
			assert.ok(Math.abs(state.input.valueRatio * width - initialFillWidth - 24) < 1e-10);
			state.move(94, { shiftKey: true });
			assert.ok(Math.abs(state.input.valueRatio * width - initialFillWidth - 26) < 1e-10);
			state.up(58);
			assert.ok(Math.abs(state.input.valueRatio * width - initialFillWidth + 10) < 1e-10);
			await nextTick();
			state.layout.width = width * 2;
			const resizedFillWidth = state.input.valueRatio * state.layout.width;
			state.down(50);
			state.up(74);
			assert.ok(Math.abs(state.input.valueRatio * state.layout.width - resizedFillWidth - 24) < 1e-10);
		}
	}
});

// 【ドラッグ中のShift切り替えは新たな移動だけを1/10にする】
// 切り替えによる値の跳躍や、通常stepへの丸めによる精密調整結果の消失を防ぐ。
test('switches precision during a drag and retains fractional steps', async t => {
	const state = fixture(t, { continuousUpdate: true });
	state.down(200);
	state.move(220);
	await nextTick();
	assert.equal(state.input.value, 60);
	state.move(240, { shiftKey: true });
	await nextTick();
	assert.equal(state.input.value, 61);
	state.move(242, { shiftKey: true });
	await nextTick();
	assert.equal(state.input.value, 61.1);
	state.up(262);
	await nextTick();
	assert.equal(state.input.value, 71.1);
});

// 【ドラッグは丸め後も範囲内に制限し、境界から逆方向へ戻せる】
// maxがstepの倍数でない場合や範囲外を直接入力した後も、クリックだけで値を変更しない。
test('clamps drag values while preserving out-of-range values until movement', async t => {
	const state = fixture(t, { modelValue: 12, min: -2, max: 9, step: 3, continuousUpdate: true });
	state.down(400);
	state.up(400);
	assert.equal(state.input.value, 12);
	state.down(400);
	state.move(500);
	await nextTick();
	assert.equal(state.input.value, 9);
	state.move(100);
	await nextTick();
	assert.equal(state.input.value, -2);
	state.up(200);
	await nextTick();
	assert.ok(state.input.value > -2 && state.input.value <= 9);
});

// 【非連続モードではドラッグ中の表示だけを変え、終了時に一度だけ通知する】
// 既存のcontinuousUpdateを指定しない呼び出し元の確定タイミングを維持する。
test('publishes deferred drag changes only on completion', async t => {
	const state = fixture(t);
	state.down(200);
	state.move(220);
	assert.equal(state.input.value, 60);
	assert.equal(state.props.modelValue, 50);
	assert.deepEqual(state.events, [['begin']]);
	state.up(240);
	await nextTick();
	assert.deepEqual(state.events, [['begin'], ['value', 70], ['dragEnded', 70], ['finish']]);
});

// 【対数範囲は小さな値を保持し、帯も同じ対数割合で表示する】
// Sizeなど桁違いの範囲を持つ入力で、線形化やstep丸めによって調整能力を失わないようにする。
test('keeps logarithmic ranges continuous with matching fill ratios', async t => {
	const state = fixture(t, { modelValue: 1, min: 0.001, max: 1000, logarithmic: true });
	assert.equal(state.input.valueRatio, 0.5);
	state.down(200);
	state.up(300);
	await nextTick();
	assert.equal(state.input.value, 1000);
	await state.input.beginEditing();
	state.input.draft = '-0.00001';
	state.input.saveEditing();
	await nextTick();
	assert.equal(state.input.value, -0.00001);
	assert.equal(state.input.valueRatio, 0);
	assert.equal(state.input.formatValue(state.input.value), '-0.00001');
});

// 【直接入力はEnterまたは確定ボタンの操作まで親へ通知せず、範囲とstepを適用しない】
// 入力途中の数値で作品を変更せず、上限超過・下限未満の値も意図どおり確定できる。
test('keeps drafts local and explicitly commits values beyond both bounds', async t => {
	const state = fixture(t, { continuousUpdate: true });
	await state.input.beginEditing();
	for (const draft of ['1', '12', '123.456']) {
		state.input.draft = draft;
		await nextTick();
		assert.deepEqual(state.events, []);
		assert.equal(state.props.modelValue, 50);
	}
	state.input.onEditorKeydown(keyEvent('Enter'));
	await nextTick();
	assert.equal(state.props.modelValue, 123.456);
	assert.equal(state.input.valueRatio, 1);
	assert.equal(state.input.editing, false);
	assert.deepEqual(state.events, [['begin'], ['value', 123.456], ['finish']]);
	await state.input.beginEditing();
	state.input.draft = '-4.25';
	state.input.saveEditing();
	await nextTick();
	assert.equal(state.props.modelValue, -4.25);
	assert.equal(state.input.valueRatio, 0);
});

// 【数式は確定時にだけ評価し、範囲外の結果も数値として通知する】
// 途中の式を親へ伝えず、四則演算・括弧・AiScriptの関数を数値入力欄と同じ仕様で利用する。
test('evaluates arithmetic and function expressions only when explicitly saved', async t => {
	const state = fixture(t);
	await state.input.beginEditing();
	for (const draft of ['(', '(1 +', '(1 + 2) * 40.5']) {
		state.input.draft = draft;
		await nextTick();
		assert.deepEqual(state.events, []);
		assert.equal(state.props.modelValue, 50);
	}
	state.input.onEditorKeydown(keyEvent('Enter'));
	await nextTick();
	assert.equal(state.props.modelValue, 121.5);
	assert.equal(state.input.editing, false);
	assert.equal(state.input.valueRatio, 1);
	assert.deepEqual(state.events, [['begin'], ['value', 121.5], ['finish']]);
	await state.input.beginEditing();
	assert.equal(state.input.draft, 121.5);
	state.input.draft = 'Math:floor(7 / 2) * -4';
	state.input.saveEditing();
	await nextTick();
	assert.equal(state.props.modelValue, -12);
	assert.equal(state.input.valueRatio, 0);
});

// 【評価に失敗した式は内容を保持し、修正・取消を受け付ける】
// 構文エラーや文字列・真理値・非有限値を数値として誤確定せず、失敗で編集履歴も増やさない。
test('preserves failed expressions until they are corrected or cancelled', async t => {
	const state = fixture(t);
	await state.input.beginEditing();
	for (const expression of ['1 +', 'missing', '"42"', 'true', 'null', '[1, 2]', '1 / 0', 'Math:sqrt(-1)', '// comment']) {
		state.input.draft = expression;
		state.input.saveEditing();
		assert.equal(state.input.editing, true, expression);
		assert.equal(state.input.draft, expression, expression);
		assert.deepEqual(state.events, [], expression);
	}
	state.input.draft = '6 / 4';
	state.input.saveEditing();
	await nextTick();
	assert.equal(state.props.modelValue, 1.5);
	await state.input.beginEditing();
	state.input.draft = '1 +';
	state.input.saveEditing();
	state.input.cancelEditing();
	assert.equal(state.input.editing, false);
	assert.equal(state.input.draft, 1.5);
});

// 【現在値と同じ結果の数式は変更通知を出さずに編集を閉じる】
// 計算結果が同じときはUndo履歴を増やさず、再編集時に以前の式も持ち越さない。
test('finishes unchanged expression results without emitting edits', async t => {
	const state = fixture(t);
	await state.input.beginEditing();
	state.input.draft = '100 / 2';
	state.input.saveEditing();
	assert.equal(state.input.editing, false);
	assert.deepEqual(state.events, []);
	await state.input.beginEditing();
	assert.equal(state.input.draft, 50);
});

// 【確定済みの数値と式ごとの実行状態は入力間で混ぜない】
// 指数表記になるモデル値を再解析せず、前回の式で定義した変数も次の確定へ持ち越さない。
test('keeps numeric model values intact and evaluates each expression independently', async t => {
	const state = fixture(t, { modelValue: 1e-7 });
	await state.input.beginEditing();
	state.input.saveEditing();
	assert.equal(state.input.editing, false);
	assert.deepEqual(state.events, []);
	await state.input.beginEditing();
	state.input.draft = 'let local = 8\nlocal * 2';
	state.input.saveEditing();
	await nextTick();
	assert.equal(state.props.modelValue, 16);
	await state.input.beginEditing();
	state.input.draft = 'local * 3';
	state.input.saveEditing();
	assert.equal(state.input.editing, true);
	assert.equal(state.props.modelValue, 16);
	assert.deepEqual(state.events, [['begin'], ['value', 16], ['finish']]);
});

// 【取消・無変更の確定・不正な入力では親へ変更を返さない】
// 空欄や非有限値を保存せず修正可能に保ち、IME確定やキーリピートで意図せず保存しない。
test('cancels drafts and ignores invalid, unchanged or composing saves', async t => {
	const state = fixture(t);
	await state.input.beginEditing();
	for (const draft of ['', ' ', 'NaN', 'Infinity', '12px']) {
		state.input.draft = draft;
		state.input.saveEditing();
		assert.equal(state.input.editing, true);
	}
	state.input.draft = 75;
	state.input.onEditorKeydown(keyEvent('Enter', { isComposing: true }));
	state.input.onEditorKeydown(keyEvent('Enter', { repeat: true }));
	assert.equal(state.input.editing, true);
	state.input.onEditorKeydown(keyEvent('Escape'));
	assert.equal(state.input.editing, false);
	await state.input.beginEditing();
	state.input.saveEditing();
	assert.equal(state.input.editing, false);
	await state.input.beginEditing();
	state.input.draft = 80;
	state.input.cancelEditing();
	assert.deepEqual(state.events, []);
	assert.equal(state.props.modelValue, 50);
});

// 【Undo/Redoの同期では変更を再通知せず、古いドラフトも残さない】
// 過去の入力を確定し直してRedo履歴を失うことを防ぎ、範囲外のモデル値も丸めず表示する。
test('synchronizes external values without emitting edits', async t => {
	const state = fixture(t);
	await state.input.beginEditing();
	state.input.draft = 75;
	state.props.modelValue = -10.1234;
	await nextTick();
	assert.equal(state.input.value, -10.1234);
	assert.equal(state.input.draft, -10.1234);
	state.input.saveEditing();
	assert.deepEqual(state.events, []);
});

// 【無効状態や別ポインターを無視し、中断・終了時はCaptureと履歴境界を必ず閉じる】
// パネルを閉じたりウィンドウがフォーカスを失った後も、ドラッグ状態が残ることを防ぐ。
test('respects disabled state and closes interrupted drag sessions', async t => {
	const state = fixture(t, { disabled: true });
	state.down(200);
	await state.input.beginEditing();
	assert.equal(state.input.editing, false);
	assert.deepEqual(state.events, []);
	state.props.disabled = false;
	await nextTick();
	state.down(200, { button: 2 });
	assert.equal(state.captures.size, 0);
	state.down(200);
	state.move(300, { pointerId: 2 });
	state.cancel();
	assert.deepEqual(state.events, [['begin'], ['finish']]);
	for (const finish of [() => state.ownerWindow.dispatchEvent(new Event('blur')), () => state.unmount()]) {
		state.down(200);
		state.move(220);
		finish();
		await nextTick();
		assert.equal(state.captures.size, 0);
		assert.equal(state.events.at(-1)[0], 'finish');
	}
});
