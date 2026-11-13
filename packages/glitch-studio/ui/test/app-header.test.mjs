import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, ref, shallowRef, nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory,
	stdin: { resolveDir: directory, contents: `
		export { default as Header } from './src/components/GsAppHeader.vue';
		export { operations, projectSessions } from '@/app.ts';
		export { menus } from '@/ui.ts';` },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	define: { __ELECTRON__: 'false' }, plugins: [i18nPlugin, {
		name: 'application-header', setup(build) {
			const stubs = {
				'@/app.ts': `import { ref } from 'vue'; export const operations = [];
					export const projectSessions = { fileOperations: { isBusy: ref(false) }, close: session => operations.push(['close', session.id]) };
					export const newProject = () => operations.push(['new']);
					export const newProjectFromImageOrVideo = () => operations.push(['media']);
					export const openProject = () => operations.push(['open']);`,
				'@/ui.ts': 'export const menus = []; export const popupMenu = items => menus.push(items); export function popup() {} export function alert() {}',
				'@/preferences.ts': "import { ref } from 'vue'; export const preferences = { model: () => ref(false) };",
				'@/desktop-update-ui.ts': 'export const desktopUpdateUi = null;',
				'@/utility/visual-module-file.ts': 'export function importVisualModuleFile() {}',
				'@/workspace.ts': 'export const workspacePanelChoices = [];',
				// フォーカス・クリップボード操作はuseHeaderEditActionsのテストで検証する。
				'@/composables/useHeaderEditActions.ts': 'export const useHeaderEditActions = () => ({});',
			};
			build.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(stubs, path) ? { path, namespace: 'header-platform' } : null);
			build.onResolve({ filter: /\.vue$/ }, ({ path }) => path.endsWith('GsAppHeader.vue') ? null : { path, namespace: 'header-control' });
			build.onLoad({ filter: /.*/, namespace: 'header-platform' }, ({ path }) => ({ contents: stubs[path], loader: 'ts' }));
			build.onLoad({ filter: /.*/, namespace: 'header-control' }, () => ({ contents: "import { h } from 'vue'; export default { setup: (_, { slots }) => () => h('div', slots.default?.()) };" }));
			build.onLoad({ filter: /GsAppHeader\.vue$/ }, async ({ path }) => {
				const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
				return { loader: 'ts', contents: compileScript(descriptor, { id: 'application-header', inlineTemplate: true }).content };
			});
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Header, operations, projectSessions, menus } = module.exports;

// 【セッション0件でも共通メニューを使え、プロジェクトの追加・切替・終了に追従する】
// ヘッダーをエディタの外へ移した後も、保存・Undoの対象を取り違えず、
// Dashboardの再表示や新規作成のためにダミーセッションを必要としないことを確認する。
// 他タブのファイル操作中も編集は使え、追加のファイル操作だけが無効になる必要がある。
test('keeps application actions available without a project and binds project actions to their session', async t => {
	const element = () => ({ children: [], parent: null, props: {} });
	const renderer = createRenderer({
		createElement: element, createText: element, createComment: element,
		setText() {}, setElementText() {}, patchProp: (node, key, _previous, value) => { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const activeSession = shallowRef(null);
	let dashboardRequests = 0;
	const root = element();
	const app = renderer.createApp({ render: () => h(Header, {
		projectSession: activeSession.value, editorEditTarget: null, onShowDashboard: () => { dashboardRequests++; },
	}) });
	app.config.globalProperties.$style = {};
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	const find = attribute => {
		const visit = node => Object.hasOwn(node.props, attribute) ? node : node.children.map(visit).find(result => result != null);
		return visit(root);
	};
	const fileMenu = () => {
		find('data-test-header-file-menu').props.onClick({ currentTarget: root });
		return menus.at(-1);
	};
	assert.equal(find('data-test-header-save').props.disabled, true);
	assert.equal(find('data-test-header-undo').props.disabled, true);
	const emptyMenu = fileMenu();
	emptyMenu.find(item => item.id === 'dashboard').action();
	assert.equal(dashboardRequests, 1);
	emptyMenu.find(item => item.id === 'new-project').action();
	assert.deepEqual(operations, [['new']]);
	assert.equal(emptyMenu.find(item => item.id === 'save-project').disabled, true);
	assert.equal(emptyMenu.find(item => item.id === 'close-project').disabled, true);
	const session = id => ({ id, hasUnsavedChanges: ref(true), isProjectSaving: ref(false), projectFileName: ref(null),
		projectContext: { stateManager: { state: { name: ref(id) }, canUndo: ref(true), canRedo: ref(false), undo: () => operations.push(['undo', id]) } },
		saveProject: () => operations.push(['save', id]),
	});
	const first = session('first');
	activeSession.value = first;
	await nextTick();
	assert.equal(find('data-test-header-save').props.disabled, false);
	assert.equal(find('data-test-header-undo').props.disabled, false);
	const firstMenu = fileMenu();
	activeSession.value = session('second');
	await nextTick();
	firstMenu.find(item => item.id === 'save-project').action();
	assert.deepEqual(operations.at(-1), ['save', 'first']);
	find('data-test-header-save').props.onClick();
	assert.deepEqual(operations.at(-1), ['save', 'second']);
	find('data-test-header-undo').props.onClick();
	assert.deepEqual(operations.at(-1), ['undo', 'second']);
	projectSessions.fileOperations.isBusy.value = true;
	await nextTick();
	assert.equal(find('data-test-header-save').props.disabled, true);
	assert.equal(find('data-test-header-undo').props.disabled, false);
	const busyMenu = fileMenu();
	for (const id of ['new-project', 'open-project', 'save-project', 'save-project-as', 'close-project']) {
		assert.equal(busyMenu.find(item => item.id === id).disabled, true);
	}
	projectSessions.fileOperations.isBusy.value = false;
	await nextTick();
	assert.equal(find('data-test-header-save').props.disabled, false);
	activeSession.value = null;
	await nextTick();
	assert.equal(find('data-test-header-save').props.disabled, true);
	fileMenu().find(item => item.id === 'dashboard').action();
	assert.equal(dashboardRequests, 2);
});
