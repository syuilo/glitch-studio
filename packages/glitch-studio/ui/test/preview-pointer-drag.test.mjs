import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';
import { fileURLToPath } from 'node:url';

const result = await build({ entryPoints: [fileURLToPath(new URL('../src/utility/preview-pointer-drag.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { startPreviewPointerDrag } = module.exports;

function fixture() {
	const view = new EventTarget();
	const doc = new EventTarget();
	doc.defaultView = view;
	const target = new EventTarget();
	target.ownerDocument = doc;
	let capture = null;
	target.setPointerCapture = id => { capture = id; };
	target.hasPointerCapture = id => capture === id;
	target.releasePointerCapture = () => { capture = null; target.dispatchEvent(new Event('lostpointercapture')); };
	const pointer = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 7, clientX: 100, clientY: 200, ...props });
	const initial = { currentTarget: target, pointerId: 7, button: 1, clientX: 100, clientY: 200, preventDefault() {} };
	return { view, doc, target, pointer, initial, capture: () => capture };
}

// 【表示先Documentで追跡し、対象外ポインターを無視して最後の位置まで反映する】
// メインwindow固定のリスナーでは別ウィンドウで操作できず、複数タッチで別の操作が混ざる。
test('tracks the captured pointer in its owner document and removes listeners on release', () => {
	const f = fixture();
	const moves = [];
	const ends = [];
	startPreviewPointerDrag(f.initial, { move: event => moves.push(event.clientX), end: cancelled => ends.push(cancelled) });
	f.doc.dispatchEvent(f.pointer('pointermove', { pointerId: 8, clientX: 900 }));
	f.doc.dispatchEvent(f.pointer('pointermove', { clientX: 140 }));
	f.doc.dispatchEvent(f.pointer('pointerup', { clientX: 160 }));
	f.doc.dispatchEvent(f.pointer('pointermove', { clientX: 500 }));
	assert.deepEqual(moves, [140, 160]);
	assert.deepEqual(ends, [false]);
	assert.equal(f.capture(), null);
});

// 【Esc・capture喪失・ウィンドウ切替で操作を一度だけ取り消す】
// キャンセル後にpointerupやpagehideが届いても確定し直さず、リスナーを残さない。
test('cancels exactly once on escape, pointer cancellation, capture loss and window exit', () => {
	for (const reason of ['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'pagehide', 'unmount']) {
		const f = fixture();
		const ends = [];
		const cancel = startPreviewPointerDrag(f.initial, { move() {}, end: value => ends.push(value) });
		if (reason === 'Escape') f.doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
		else if (reason === 'pointercancel') f.doc.dispatchEvent(f.pointer(reason));
		else if (reason === 'lostpointercapture') f.target.dispatchEvent(new Event(reason));
		else if (reason === 'unmount') cancel();
		else f.view.dispatchEvent(new Event(reason));
		f.doc.dispatchEvent(f.pointer('pointerup'));
		cancel();
		assert.deepEqual(ends, [true], reason);
		assert.equal(f.capture(), null);
	}
});

// 実コンポーネントの入口を使い、DOM座標の入力・保存値の境界をテストする。
const source = await readFile(new URL('../src/components/GsPreview.vue', import.meta.url), 'utf8');
const { scriptSetup, template } = parse(source).descriptor;
const script = scriptSetup.content;
const ast = createSourceFile('GsPreview.ts', script, ScriptTarget.Latest);
async function compilePreviewHandler(name) {
	const handler = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === name);
	return (await transform(handler.getText(ast), { loader: 'ts' })).code;
}
const panHandler = await compilePreviewHandler('onViewPointerdown');
const createPan = new Function('context', `const { pan, panning, startPreviewPointerDrag } = context; let stopPan; ${panHandler}; return onViewPointerdown;`);

// 【中ボタンの累積移動は表示位置だけへ反映し、キャンセルで開始位置へ戻す】
// 左ボタンのレイヤー変形と競合させず、二回目の移動を前回値へ足して加速させない。
test('pans the preview only with the middle button and restores the starting view on cancel', () => {
	const f = fixture();
	const pan = { value: [20, 30] };
	const panning = { value: false };
	const start = createPan({ pan, panning, startPreviewPointerDrag });
	start({ ...f.initial, button: 0 });
	assert.equal(panning.value, false);
	start(f.initial);
	f.doc.dispatchEvent(f.pointer('pointermove', { clientX: 140, clientY: 210 }));
	f.doc.dispatchEvent(f.pointer('pointermove', { clientX: 150, clientY: 230 }));
	assert.deepEqual(pan.value, [70, 60]);
	f.doc.dispatchEvent(f.pointer('pointercancel'));
	assert.deepEqual(pan.value, [20, 30]);
	assert.equal(panning.value, false);
	start(f.initial);
	f.doc.dispatchEvent(f.pointer('pointerup', { clientX: 110, clientY: 205 }));
	assert.deepEqual(pan.value, [30, 35]);
	assert.equal(panning.value, false);
});

// 【プレビューCanvasの主ボタン押下と指の接触を位置入力にする】
// Canvasの拡大・移動後も画面上の入力位置を原点中央・上向きの座標で送り、余白や中ボタンのパンでは発火させない。
test('sends primary canvas pointerdowns as normalized positions only in Effect Live Preview', async () => {
	assert.match(template.content, /data-test-preview-canvas-container[^>]*@pointerdown="onCanvasPointerdown"/);
	const pointerdownHandler = await compilePreviewHandler('onCanvasPointerdown');
	const createPointerdown = new Function('previewPlayback', 'effectLivePreviewManagerController', `${pointerdownHandler}; return onCanvasPointerdown;`);
	const state = { value: { mode: 'effectLivePreview' } };
	const clicks = [];
	const press = createPointerdown({ state }, { click: position => clicks.push(position) });
	const currentTarget = { getBoundingClientRect: () => ({ left: 100, top: 200, width: 400, height: 200 }) };
	const primary = { isPrimary: true, button: 0, clientX: 400, clientY: 250, currentTarget };
	press(primary);
	press({ ...primary, pointerType: 'touch', clientX: 200, clientY: 350 });
	press({ ...primary, pointerType: 'touch', isPrimary: false });
	press({ ...primary, button: 1 });
	press({ ...primary, clientX: 501 });
	state.value.mode = 'timeline';
	press(primary);
	assert.deepEqual(clicks, [{ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 }]);
});
