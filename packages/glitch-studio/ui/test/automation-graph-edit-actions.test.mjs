import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const path = fileURLToPath(new URL('../src/components/GsAutomationGraphPointsEditor.vue', import.meta.url));
const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
const script = compileScript(descriptor, { id: 'graph-edit-test' }).content;
const bundle = await build({ stdin: { contents: script, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'graph-controls', setup(build) {
		build.onResolve({ filter: /\.vue$/ }, () => ({ path: 'control', namespace: 'graph-control' }));
		build.onLoad({ filter: /.*/, namespace: 'graph-control' }, () => ({ contents: 'export default {};' }));
	} }],
});
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
async function fixture(t) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'window', 'HTMLElement', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports,
		{ document: { getSelection: () => null } }, class {});
	const props = reactive({ isNormalized: true, points: [0, 0.4, 1].map((x, index) => ({ id: `p${index}`, x, y: index,
		bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] })) });
	const changes = [];
	let editor;
	const component = { ...module.exports.default, render: () => null };
	const app = renderer.createApp({ render: () => h(component, { ...props,
		ref: instance => { if (instance != null) editor = instance.$.setupState; }, onChange: points => changes.push(points) }) });
	app.mount({});
	t.after(() => app.unmount());
	await nextTick();
	return { editor, changes };
}
const event = (overrides = {}) => ({ target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...overrides });

// 【グラフの切り取りで固定端点を残し、削除可能なポイントだけをメモリに保存する】
// 正規化グラフの端点は必須なので切り取りで失わず、一操作の変更通知も一回にまとめる必要がある。
test('cuts removable graph points while preserving fixed endpoints and one change notification', async t => {
	const { editor, changes } = await fixture(t);
	editor.selectedPoints = [...editor.ppints];
	editor.editEvents.onCut(event());
	await nextTick();
	assert.deepEqual(editor.ppints.map(point => point.x), [0, 1]);
	assert.deepEqual(editor.copyingPoints.map(point => point.x), [0.4]);
	assert.equal(changes.length, 1);
	editor.cursorValueX = 0.7;
	editor.editEvents.onPaste(event());
	await nextTick();
	assert.deepEqual(editor.ppints.map(point => point.x), [0, 0.7, 1]);
	assert.equal(changes.length, 2);
});

// 【グラフのDeleteとBackspaceはコピー内容を維持し、端点だけの切り取りは無操作にする】
// コピー済みポイントをDeleteで上書きせず、削除できない選択のCutでクリップボードを空にしない。
test('preserves copied graph points across deletion and refuses cutting fixed endpoints alone', async t => {
	const { editor, changes } = await fixture(t);
	editor.selectedPoints = [editor.ppints[1]];
	editor.editEvents.onCopy(event());
	const clipboard = editor.copyingPoints;
	editor.editEvents.onKeydown(event({ key: 'Backspace' }));
	await nextTick();
	assert.equal(editor.copyingPoints, clipboard);
	assert.deepEqual(editor.ppints.map(point => point.x), [0, 1]);
	editor.selectedPoints = [...editor.ppints];
	editor.editEvents.onCut(event());
	editor.editEvents.onKeydown(event({ key: 'Delete' }));
	await nextTick();
	assert.equal(editor.copyingPoints, clipboard);
	assert.equal(changes.length, 1);
});
