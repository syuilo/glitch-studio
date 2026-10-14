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
		export { preferences } from '@/preferences.ts';
		export { getActiveDragData, getDragSessionData } from './src/utility/drag-and-drop.ts';` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [{ name: 'drag-session-components', setup(build) {
		build.onResolve({ filter: /^@\/(preferences|workspace|app|ui)\.ts$/ }, ({ path }) => ({ path: path.slice(2), namespace: 'test' }));
		build.onResolve({ filter: /open-media-file\.ts$/ }, () => ({ path: 'media', namespace: 'test' }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => {
			if (/Gs(?:Draggable|WorkspacePanel|WorkspaceDivider|Asset)\.vue$/.test(path)) return;
			return { path: basename(path, '.vue'), namespace: 'control' };
		});
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: {
			'preferences.ts': `import { ref } from 'vue'; export const preferences = { r: { workspaceDefinition: ref(null) }, commits: [],
				get s() { return { workspaceDefinition: this.r.workspaceDefinition.value }; },
				commit(key, value) { this.commits.push(value); this.r[key].value = value; } };`,
			'workspace.ts': `export const workspacePanelDefinitions = { assets: { icon: '', label: 'Assets', component: 'div' } }; export function getElementMenu() { return []; }`,
			'app.ts': `export const appContext = { projectContext: { stateManager: { commit() {} } } };`,
			'ui.ts': 'export function popup() {} export function popupMenu() {} export function contextMenu() {} export function alert() {}',
			media: 'export async function openMediaFile() {}',
		}[path] }));
		build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ loader: 'ts', contents: `
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
const { Draggable, Panel, Divider, Asset, preferences, getActiveDragData, getDragSessionData } = module.exports;

function fixture(t, render) {
	const windowTarget = new EventTarget();
	const element = tag => ({ tag, parent: null, children: [], props: {}, text: '', ownerDocument: { defaultView: windowTarget } });
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
	app.component('TestTransitionGroup', { setup(_, { attrs, slots }) { return () => h('div', attrs, slots.default()); } });
	app.mount(root);
	t.after(() => app.unmount());
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	const find = (attribute, value, target = root) => descendants(target).find(node => attribute in node.props && (value == null || node.props[attribute] === value));
	return { root, find, windowTarget };
}

function transfer() {
	const values = new Map();
	return { files: [], get types() { return [...values.keys()]; }, setData: (type, value) => values.set(type, value), getData: type => values.get(type) ?? '' };
}

function event(type, dataTransfer, node) {
	const value = new Event(type, { cancelable: true });
	value.dataTransfer = dataTransfer;
	Object.defineProperty(value, 'currentTarget', { value: node });
	Object.defineProperty(value, 'target', { value: node });
	return value;
}

const settle = async () => { await new Promise(resolve => setTimeout(resolve, 20)); await nextTick(); };
const list = (model, group, key) => h(Draggable, { modelValue: model.value, group, direction: 'vertical', 'data-test-list': key,
	'onUpdate:modelValue': value => { model.value = value; } }, { default: ({ item }) => h('span', item.name ?? item.id) });

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
