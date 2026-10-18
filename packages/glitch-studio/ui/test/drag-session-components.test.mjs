import { i18nPlugin } from './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';
import { parse, compileScript } from 'vue/compiler-sfc';
import { createRenderer, h, ref, nextTick } from 'vue';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { default as Draggable } from './src/components/common/GsDraggable.vue';
		export { default as Panel } from './src/components/GsWorkspacePanel.vue';
		export { default as Divider } from './src/components/GsWorkspaceDivider.vue';
		export { default as Asset } from './src/components/GsAsset.vue';
		export { default as VisualModuleEditor } from './src/components/GsVisualModuleEditor.vue';
		export { default as AssetSelectDialog } from './src/components/GsAssetSelectDialog.vue';
		export { default as DashboardDialog } from './src/components/GsDashboardDialog.vue';
		export { workspaceControllerKey } from './src/WorkspaceController.ts';
		export { assetImportTest } from '@/utility/import-assets.ts';
		export { preferences } from '@/preferences.ts';
		export { recentProjects } from './src/recent-projects.ts';
		export { dashboardTest } from '@/app.ts';
		export { getActiveDragData, getDragSessionData } from './src/utility/drag-and-drop.ts';` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	define: { _VERSION_: '"test"', __ELECTRON__: 'false' },
	plugins: [i18nPlugin, { name: 'drag-session-components', setup(build) {
		build.onResolve({ filter: /^@\/(preferences|workspace|app|ui)\.ts$/ }, ({ path }) => ({ path: path.slice(2), namespace: 'test' }));
		build.onResolve({ filter: /open-media-file\.ts$/ }, () => ({ path: 'media', namespace: 'test' }));
		build.onResolve({ filter: /import-assets\.ts$/ }, () => ({ path: 'asset-import', namespace: 'test' }));
		build.onResolve({ filter: /visual-module-wires\.ts$/ }, () => ({ path: 'wires', namespace: 'test' }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => {
			if (/Gs(?:Draggable|WorkspacePanel|WorkspaceDivider|Asset|VisualModuleEditor|AssetSelectDialog|DashboardDialog)\.vue$/.test(path)) return;
			return { path: basename(path, '.vue'), namespace: 'control' };
		});
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: {
			'preferences.ts': `import { ref } from 'vue'; export const preferences = { r: { workspaceDefinition: ref(null) }, commits: [],
				get s() { return { workspaceDefinition: this.r.workspaceDefinition.value }; },
				commit(key, value) { this.commits.push(value); this.r[key].value = value; } };`,
			'workspace.ts': `export const workspacePanelDefinitions = { assets: { icon: '', label: 'Assets', component: 'div' } }; export function getElementMenu() { return []; }`,
			'app.ts': `export const appContext = { projectContext: { hasProject: true, stateManager: { commit() {} } } };
				export const dashboardTest = { opened: [], success: true };
				export async function newProject() {} export async function newProjectFromImageOrVideo() { return true; }
				export async function openProject(file, handle) { dashboardTest.opened.push({ file, handle }); return dashboardTest.success; }`,
			'ui.ts': 'export function progress() { return { done() {} }; } export function popup() {} export function popupMenu() {} export function contextMenu() {} export function alert() {} export async function confirm() { return { canceled: false }; }',
			media: 'export async function openMediaFile() {}',
			'asset-import': `export const assetImportTest = { calls: [], read: null };
				export async function importAssets(context, files) { assetImportTest.calls.push({ context, files });
					return assetImportTest.read == null ? ['asset'] : assetImportTest.read(); }`,
			wires: 'export function provideVisualModuleWires() {}',
		}[path] }));
		build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ loader: 'ts', contents: path === 'GsModal' ? `
			import { h, useTemplateRef } from 'vue'; export default { setup(_, { attrs, slots, expose }) {
				const root = useTemplateRef('root'); expose({ getRootElement: () => root.value, close() { root.value.props['data-test-modal-closed'] = true; } });
				return () => h('div', { ...attrs, ref: 'root' }, [h('div', { 'data-test-modal-background': '' }),
					...Object.values(slots).flatMap(slot => slot())]);
			} };` : `
			import { h } from 'vue'; export default { setup(_, { attrs, slots }) { return () => h(${JSON.stringify(path)}, attrs,
				Object.values(slots).flatMap(slot => slot())); } };` }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const source = await readFile(path, 'utf8');
			// レイアウトやCSSトランジションを実行せず、実際のSFCとドラッグ状態・イベントの接続を検証する。
			const descriptor = parse(source.replaceAll('TransitionGroup', 'TestTransitionGroup'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: basename(path), inlineTemplate: true, genDefaultAs: 'component' }).content;
			const classes = Object.fromEntries([...source.matchAll(/\.([A-Za-z]\w*)\s*\{/g)].map(match => [match[1], match[1]]));
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}
				component.__cssModules = { $style: ${JSON.stringify(classes)} }; export default component;` };
		});
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Draggable, Panel, Divider, Asset, VisualModuleEditor, AssetSelectDialog, DashboardDialog, workspaceControllerKey, assetImportTest,
	preferences, getActiveDragData, getDragSessionData, recentProjects, dashboardTest } = module.exports;

function fixture(t, render, provide = () => {}) {
	const windowTarget = new EventTarget();
	const body = { hasAttribute: () => false };
	const element = tag => Object.assign(new EventTarget(), { tag, parent: null, children: [], props: {}, text: '',
		ownerDocument: { defaultView: windowTarget, body }, contains(node) { return node === this || (node?.parent != null && this.contains(node.parent)); },
		dispatchEvent(event) {
			let stopped = false;
			const previousStop = event.stopPropagation;
			event.stopPropagation = () => { stopped = true; previousStop.call(event); };
			const result = EventTarget.prototype.dispatchEvent.call(this, event);
			event.stopPropagation = previousStop;
			if (event.bubbles && !stopped && this.parent != null) return this.parent.dispatchEvent(event);
			return result;
		} });
	const renderer = createRenderer({ createElement: element, createText: text => ({ ...element('text'), text }), createComment: () => element('comment'),
		setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; }, patchProp: (node, key, _old, value) => { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const root = element('root');
	const app = renderer.createApp({ setup: () => render });
	app.directive('tooltip', {});
	provide(app);
	app.component('TestTransitionGroup', { setup(_, { attrs, slots }) { return () => h('div', attrs, slots.default()); } });
	app.mount(root);
	t.after(() => app.unmount());
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	const find = (attribute, value, target = root) => descendants(target).find(node => attribute in node.props && (value == null || node.props[attribute] === value));
	return { root, find, windowTarget, body, app };
}

function transfer() {
	const values = new Map();
	return { files: [], get types() { return [...values.keys()]; }, setData: (type, value) => values.set(type, value), getData: type => values.get(type) ?? '' };
}

function event(type, dataTransfer, node) {
	const value = new Event(type, { cancelable: true, bubbles: true });
	value.dataTransfer = dataTransfer;
	Object.defineProperty(value, 'currentTarget', { value: node });
	Object.defineProperty(value, 'target', { value: node });
	return value;
}

const settle = async () => { await new Promise(resolve => setTimeout(resolve, 20)); await nextTick(); };
const list = (model, group, key) => h(Draggable, { modelValue: model.value, group, direction: 'vertical', 'data-test-list': key,
	'onUpdate:modelValue': value => { model.value = value; } }, { default: ({ item }) => h('span', item.name ?? item.id) });

// 【履歴を表示し、GsTimeへ日時を渡し、開けたときだけダッシュボードを閉じる】
// 一覧だけ表示できても実際の再オープンに接続されていなければ利用できない。
// 履歴の削除・全消去後の空表示も、実SFCのイベントとリアクティブな更新で検証する。
test('renders recent projects with GsTime and connects reopening, removal and clearing', async t => {
	const previousStore = recentProjects.store;
	const previousEntries = recentProjects.entries.value;
	let entries = [
		{ id: 'first', name: 'First project', fileName: 'same.gsproj', lastUsedAt: 1000 },
		{ id: 'second', name: 'Second project', fileName: 'same.gsproj', lastUsedAt: 2000 },
	];
	const resolved = { kind: 'file', name: 'same.gsproj' };
	recentProjects.store = {
		async list() { return [...entries]; }, async resolve() { return resolved; },
		async remove(id) { entries = entries.filter(entry => entry.id !== id); }, async clear() { entries = []; },
	};
	dashboardTest.opened = [];
	dashboardTest.success = false;
	t.after(() => {
		recentProjects.store = previousStore;
		recentProjects.entries.value = previousEntries;
		dashboardTest.success = true;
	});
	const f = fixture(t, () => h(DashboardDialog), app => app.provide(workspaceControllerKey, { revealPanel() {} }));
	assert.ok(f.find('data-test-recent-projects-loading'));
	await settle();
	assert.equal(f.find('data-test-recent-projects-loading'), undefined);
	assert.equal(f.find('data-test-recent-project-time').tag, 'GsTime');
	assert.equal(f.find('data-test-recent-project-time').props.time, 1000);
	await f.find('data-test-open-recent-project').props.onClick();
	assert.deepEqual(dashboardTest.opened, [{ file: null, handle: resolved }]);
	assert.equal(f.find('data-test-modal-closed'), undefined);
	dashboardTest.success = true;
	await f.find('data-test-open-recent-project').props.onClick();
	assert.ok(f.find('data-test-modal-closed'));
	await f.find('data-test-remove-recent-project').props.onClick();
	await nextTick();
	assert.equal(recentProjects.entries.value.length, 1);
	await f.find('data-test-clear-recent-projects').props.onClick();
	await nextTick();
	assert.ok(f.find('data-test-recent-projects-empty'));
});

// 【背景を含むAsset選択モーダル全体で複数ファイルを取り込み、選択の確定はユーザーの操作に残す】
// popupはAppの全体ドロップ受付へ届かないため、実SFCに受付を接続して確認する。
// 選択一覧だけへリスナーを登録すると背景へのドロップがブラウザへ渡るため、背景から伝播させる。
// 単一選択・MIME絞り込みのダイアログでも任意ファイルの取り込みを許可し、取り込み中の
// 二重ドロップ・操作ロック中の受付・破棄後のリスナー残留を防ぐ。
test('imports file batches in the asset picker without confirming the selection and cleans up handlers', async t => {
	assetImportTest.calls = [];
	const gate = Promise.withResolvers();
	assetImportTest.read = () => gate.promise;
	t.after(() => { assetImportTest.read = null; });
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const reveals = [], confirmations = [];
	const f = fixture(t, () => h(AssetSelectDialog, { multiple: false, mimeType: 'image/*', onDone: value => confirmations.push(value) }),
		app => app.provide(workspaceControllerKey, { revealPanel: value => reveals.push(value) }));
	globalThis.window = { document: { body: f.body } };
	t.after(() => {
		if (previousWindow == null) delete globalThis.window;
		else Object.defineProperty(globalThis, 'window', previousWindow);
	});
	const target = f.find('data-test-asset-select-file-drop');
	const background = f.find('data-test-modal-background');
	const content = f.find('data-test-asset-select-content');
	const files = [new File(['image'], 'image.png', { type: 'image/png' }), new File(['text'], 'notes.txt', { type: 'text/plain' })];
	const transfer = { types: ['Files'], files, dropEffect: 'move' };
	const over = event('dragover', transfer, background);
	background.dispatchEvent(over);
	await nextTick();
	assert.equal(over.defaultPrevented, true);
	assert.equal(transfer.dropEffect, 'copy');
	assert.ok(f.find('data-test-asset-select-drop-overlay'));
	const leave = event('dragleave', transfer, background);
	leave.relatedTarget = content;
	background.dispatchEvent(leave);
	await nextTick();
	assert.ok(f.find('data-test-asset-select-drop-overlay'), 'Moving from the background to the dialog content remains inside the drop target');
	background.dispatchEvent(event('drop', transfer, background));
	transfer.files = [];
	content.dispatchEvent(event('drop', { types: ['Files'], files }, content));
	assert.deepEqual(assetImportTest.calls[0].files, files);
	assert.equal(assetImportTest.calls.length, 1);
	gate.resolve(['image', 'text']);
	await new Promise(resolve => setImmediate(resolve));
	await nextTick();
	assert.equal(f.find('data-test-asset-select-drop-overlay'), undefined);
	assert.deepEqual(reveals, []);
	assert.deepEqual(confirmations, []);
	f.body.hasAttribute = () => true;
	background.dispatchEvent(event('drop', { types: ['Files'], files }, background));
	assert.equal(assetImportTest.calls.length, 1);
	f.body.hasAttribute = () => false;
	f.app.unmount();
	const dropped = event('drop', { types: ['Files'], files }, target);
	target.dispatchEvent(dropped);
	assert.equal(dropped.defaultPrevented, false);
	assert.equal(assetImportTest.calls.length, 1);
});

// 【Dashboardのモーダル全体へ共通ドロップ受付を登録し、破棄時に解除する】
// ファイルの分岐だけをテストすると、SFCのマウント時に受付を接続し忘れても検出できない。
// 背景への実イベントから汎用ファイルを取り込み、閉じたモーダルでは再取り込みしない。
test('connects dashboard background drops to the utility and removes handlers on unmount', async t => {
	assetImportTest.calls = [];
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const reveals = [];
	const f = fixture(t, () => h(DashboardDialog), app => app.provide(workspaceControllerKey, { revealPanel: value => reveals.push(value) }));
	globalThis.window = { document: { body: f.body } };
	t.after(() => {
		if (previousWindow == null) delete globalThis.window;
		else Object.defineProperty(globalThis, 'window', previousWindow);
	});
	const background = f.find('data-test-modal-background');
	const files = [new File(['text'], 'notes.txt', { type: 'text/plain' })];
	const dropped = event('drop', { types: ['Files'], files }, background);
	background.dispatchEvent(dropped);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(dropped.defaultPrevented, true);
	assert.deepEqual(assetImportTest.calls[0].files, files);
	assert.deepEqual(reveals, [{ contentType: 'assets', sourcePanelId: null }]);
	f.app.unmount();
	background.dispatchEvent(event('drop', { types: ['Files'], files }, background));
	assert.equal(assetImportTest.calls.length, 1);
});

// 【共通セッションで通常の並び替えを行い、現在の要素への編集を維持する】
// dragstart時のスナップショットで同じ一覧の最新の値を上書きせず、drop後にドラッグ表示を残さない。
test('reorders a list using its current item and ends the common drag session', async t => {
	const model = ref([{ id: 'a', name: 'old' }, { id: 'b' }]);
	const f = fixture(t, () => list(model, 'group', 'list'));
	const source = f.find('data-test-draggable-item', 'a');
	const data = transfer();
	source.props.onDragstart(event('dragstart', data, source));
	model.value[0].name = 'edited';
	await settle();
	const target = f.find('data-test-draggable-drop', 'after', f.find('data-test-draggable-item', 'b'));
	const over = event('dragover', data, target);
	target.props.onDragover(over);
	assert.equal(over.defaultPrevented, true);
	target.props.onDrop(event('drop', data, target));
	assert.deepEqual(model.value.map(item => item.id), ['b', 'a']);
	assert.equal(model.value[1].name, 'edited');
	assert.equal(getDragSessionData('GsDraggable'), null);
});

// 【同じグループの空一覧へ移動し、異なるグループや外部ファイルは受け取らない】
// 空一覧への移動でも元一覧の削除を一度だけ通知し、別グループの一覧を誤って変更しない。
// 素材ファイルのイベントは上位のアプリ全体受付へ伝播できる状態を保つ。
test('moves between matching lists and rejects unrelated groups and file drags', async t => {
	const sourceModel = ref([{ id: 'a' }]);
	const targetModel = ref([]);
	const otherModel = ref([]);
	const f = fixture(t, () => h('div', [list(sourceModel, 'group', 'source'), list(targetModel, 'group', 'target'), list(otherModel, 'other', 'other')]));
	const source = f.find('data-test-draggable-item', 'a');
	const data = transfer();
	source.props.onDragstart(event('dragstart', data, source));
	await settle();
	const other = f.find('data-test-draggable-empty', null, f.find('data-test-list', 'other'));
	const rejected = event('dragover', data, other);
	other.props.onDragover(rejected);
	assert.equal(rejected.defaultPrevented, false);
	other.props.onDrop(event('drop', data, other));
	assert.equal(sourceModel.value.length, 1);
	assert.equal(otherModel.value.length, 0);
	const target = f.find('data-test-draggable-empty', null, f.find('data-test-list', 'target'));
	const files = { types: ['Files'], files: [] };
	const fileOver = event('dragover', files, target);
	target.props.onDragover(fileOver);
	assert.equal(fileOver.defaultPrevented, false);
	target.props.onDrop(event('drop', data, target));
	assert.equal(sourceModel.value.length, 0);
	assert.deepEqual(targetModel.value.map(item => item.id), ['a']);
});

// 【開始元のアンマウントでセッションを破棄し、終了後のホバーでは移動を許可しない】
// dragendが届かない場合でも、開始元コンポーネントへの参照や古いドラッグ表示を保持しない。
test('disposes the session when its source component unmounts', async t => {
	const shown = ref(true);
	const sourceModel = ref([{ id: 'a' }]);
	const targetModel = ref([]);
	const f = fixture(t, () => h('div', [shown.value ? list(sourceModel, 'group', 'source') : null, list(targetModel, 'group', 'target')]));
	const source = f.find('data-test-draggable-item', 'a');
	const data = transfer();
	source.props.onDragstart(event('dragstart', data, source));
	shown.value = false;
	await settle();
	assert.equal(getDragSessionData('GsDraggable'), null);
	const target = f.find('data-test-draggable-empty');
	const over = event('dragover', data, target);
	target.props.onDragover(over);
	assert.equal(over.defaultPrevented, false);
});

// 【パネル交換とDivider内の挿入で共通のドラッグデータを使う】
// app.tsのグローバルIDを廃止しても、両方の受付が同じ開始元を移動し、保存レイアウトへ反映できる。
test('moves workspace panels through both panel and divider drop targets', async t => {
	const panels = ['a', 'b', 'c'].map(id => ({ id, type: 'panel', direction: 'horizontal', contentType: 'assets' }));
	const layout = { id: 'root', type: 'divider', direction: 'horizontal', children: panels.map(element => ({ ratio: 1 / 3, element })) };
	preferences.r.workspaceDefinition.value = layout;
	preferences.commits = [];
	const f = fixture(t, () => h('div', [...panels.map(panel => h(Panel, { panel })), h(Divider, { divider: preferences.r.workspaceDefinition.value })]));
	const source = f.find('data-test-workspace-panel-grabber', null, f.find('data-test-workspace-panel', 'a'));
	const data = transfer();
	source.props.onDragstart(event('dragstart', data, source));
	await settle();
	const target = f.find('data-test-workspace-panel-drop', 'center', f.find('data-test-workspace-panel', 'b'));
	const over = event('dragover', data, target);
	target.props.onDragover(over);
	assert.equal(over.defaultPrevented, true);
	target.props.onDrop(event('drop', data, target));
	assert.deepEqual(preferences.s.workspaceDefinition.children.map(child => child.element.id), ['b', 'a', 'c']);
	await nextTick();
	const sourceC = f.find('data-test-workspace-panel-grabber', null, f.find('data-test-workspace-panel', 'c'));
	const second = transfer();
	sourceC.props.onDragstart(event('dragstart', second, sourceC));
	await settle();
	const divider = f.find('data-test-workspace-divider-drop', 0);
	divider.props.onDrop(event('drop', second, divider));
	assert.deepEqual(preferences.s.workspaceDefinition.children.map(child => child.element.id), ['b', 'c', 'a']);
	assert.equal(preferences.commits.length, 2);
	assert.equal(getDragSessionData('WorkspacePanel'), null);
});

// 【Assetから開始したドラッグも共通セッションで参照し、開始元の破棄で消える】
// 未使用のローカルisDraggingを削除しても、Timelineなどの受付へAsset IDを渡せる。
test('shares asset drag data and clears it when the asset view is removed', async t => {
	const shown = ref(true);
	const asset = { id: 'asset', name: 'Image', fileDataType: 'image/png', fileData: new Blob() };
	const f = fixture(t, () => shown.value ? h(Asset, { asset }) : h('div'));
	const source = f.find('data-test-asset', 'asset');
	const data = transfer();
	source.props.onDragstart(event('dragstart', data, source));
	assert.deepEqual(getActiveDragData(event('dragover', data, source), 'GsAsset'), { assetId: 'asset' });
	shown.value = false;
	await settle();
	assert.equal(getActiveDragData(event('dragover', data, source), 'GsAsset'), null);
});

// 【Visual Module Editor全体でファイルとAssetを受け付け、対象外Assetにもホバー表示を出す】
// Nodes以外のタブからの追加も可能にし、成功後はNodesを表示する。対象外のAssetはタブを変えない。
// ファイル一覧はイベント中に保存し、内部ノード並び替えのドラッグはそのまま通過させる。
test('accepts files and assets across the Visual Module editor and selects nodes after an addition', async t => {
	const calls = [];
	const asset = { id: 'font', name: 'Font', fileDataType: 'font/ttf', fileData: new Blob() };
	const actions = { dropFiles: async files => { calls.push(files.map(file => file.name)); return true; },
		dropAsset: async assetId => { calls.push(assetId); return false; } };
	const f = fixture(t, () => h('div', [h(Asset, { asset }), h(VisualModuleEditor, {
		visualModule: { nodes: [], paramDefs: [], outputDefs: [] }, visualModuleName: 'Visual Module', assetDropActions: actions,
	})]));
	const editor = f.find('data-test-visual-module-editor');
	const tabs = f.find('data-test-visual-module-tabs');
	tabs.props['onUpdate:modelValue']('other');
	await nextTick();
	const files = transfer();
	files.setData('Files', '');
	files.files.push(new File([], 'image.png'), new File([], 'video.mp4'));
	const entered = event('dragenter', files, editor);
	editor.props.onDragenterCapture(entered);
	await nextTick();
	assert.ok(f.find('data-test-visual-module-drop-overlay'));
	assert.equal(entered.defaultPrevented, true);
	assert.equal(entered.cancelBubble, true);
	const dropped = editor.props.onDropCapture(event('drop', files, editor));
	files.files.length = 0;
	await dropped;
	await nextTick();
	assert.deepEqual(calls[0], ['image.png', 'video.mp4']);
	assert.equal(tabs.props.modelValue, 'nodes');
	assert.equal(f.find('data-test-visual-module-drop-overlay'), undefined);
	tabs.props['onUpdate:modelValue']('other');
	await nextTick();
	const source = f.find('data-test-asset', 'font');
	const data = transfer();
	source.props.onDragstart(event('dragstart', data, source));
	editor.props.onDragenterCapture(event('dragenter', data, editor));
	await nextTick();
	assert.ok(f.find('data-test-visual-module-drop-overlay'));
	await editor.props.onDropCapture(event('drop', data, editor));
	await nextTick();
	assert.equal(calls.at(-1), 'font');
	assert.equal(tabs.props.modelValue, 'other');
	const internal = transfer();
	internal.setData('glitch-studio/gsdraggable', '');
	const over = event('dragover', internal, editor);
	editor.props.onDragoverCapture(over);
	assert.equal(over.defaultPrevented, false);
	assert.equal(over.cancelBubble, false);
});

// 【VueのAsset受付も共通の操作ロック・二重処理防止・有効状態に従う】
// ユーティリティ単体だけを確認すると、Composableがロック判定やライフサイクルを接続し忘れた
// 不具合を見逃す。ファイルと既存Assetの両方を拒否し、対象外のドラッグは伝播させる。
test('applies shared locking and disabled state to the Vue asset drop target', async t => {
	const calls = [];
	const gate = Promise.withResolvers();
	const actions = ref({ dropFiles: async files => { calls.push(files); await gate.promise; return true; },
		dropAsset: async assetId => { calls.push(assetId); return true; } });
	const asset = { id: 'asset', name: 'Image', fileDataType: 'image/png', fileData: new Blob() };
	const f = fixture(t, () => h('div', [h(Asset, { asset }), h(VisualModuleEditor, {
		visualModule: { nodes: [], paramDefs: [], outputDefs: [] }, visualModuleName: 'Visual Module', assetDropActions: actions.value,
	})]));
	const editor = f.find('data-test-visual-module-editor');
	const files = transfer();
	files.setData('Files', '');
	files.files.push(new File([], 'image.png'));
	const data = transfer();
	const source = f.find('data-test-asset', 'asset');
	source.props.onDragstart(event('dragstart', data, source));
	f.body.hasAttribute = () => true;
	for (const drag of [files, data]) {
		const over = event('dragover', drag, editor);
		editor.props.onDragoverCapture(over);
		assert.equal(over.defaultPrevented, true);
		assert.equal(drag.dropEffect, 'none');
		await editor.props.onDropCapture(event('drop', drag, editor));
	}
	assert.deepEqual(calls, []);
	f.body.hasAttribute = () => false;
	const pending = editor.props.onDropCapture(event('drop', files, editor));
	await editor.props.onDropCapture(event('drop', files, editor));
	assert.equal(calls.length, 1);
	gate.resolve();
	await pending;
	actions.value = null;
	await nextTick();
	const disabled = event('dragover', files, editor);
	editor.props.onDragoverCapture(disabled);
	assert.equal(disabled.defaultPrevented, false);
	assert.equal(disabled.cancelBubble, false);
});
