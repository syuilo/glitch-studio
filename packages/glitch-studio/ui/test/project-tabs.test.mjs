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
const bundle = await build({ absWorkingDir: directory, entryPoints: ['./src/components/GsProjectTabs.vue'],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [i18nPlugin, {
		name: 'project-tabs-component', setup(build) {
			build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
				const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
				return { loader: 'ts', contents: compileScript(descriptor, { id: 'project-tabs', inlineTemplate: true }).content };
			});
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const Tabs = module.exports.default;

// 【タブに表示用の名前と保存状態を反映し、切替・終了を所属セッションへ渡す】
// 編集用の名前を直接表示すると、名前が空のプロジェクトでファイル名や未保存表示を使えない。
// 保存後の名前の更新に追従し、ファイル操作中は切替だけを許可することも確認する。
test('displays current project names and save status while routing selection and close to their owners', async t => {
	const element = () => ({ children: [], parent: null, props: {} });
	const renderer = createRenderer({
		createElement: element, createText: element, createComment: element,
		setText() {}, setElementText: (node, text) => { node.text = text; }, patchProp: (node, key, _previous, value) => { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const session = id => ({ id, projectDisplayName: ref(id), hasUnsavedChanges: ref(false), isProjectSaving: ref(false) });
	const first = session('(Unsaved)');
	const second = session('second.gsproj');
	const manager = { sessions: shallowRef([first]), activeSession: shallowRef(first),
		fileOperations: { isBusy: ref(false) },
		select(target) { this.activeSession.value = target; }, close(target) { this.sessions.value = this.sessions.value.filter(session => session !== target); } };
	const root = element();
	const app = renderer.createApp({ render: () => h(Tabs, { manager }) });
	app.config.globalProperties.$style = {};
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	const find = attribute => {
		const nodes = [];
		const visit = node => { if (Object.hasOwn(node.props, attribute)) nodes.push(node); node.children.forEach(visit); };
		visit(root);
		return nodes;
	};
	assert.equal(find('data-test-project-tabs').length, 1);
	assert.deepEqual(find('data-test-project-tab-name').map(node => node.text), ['(Unsaved)']);
	manager.sessions.value = [first, second];
	await nextTick();
	assert.equal(find('data-test-project-tabs').length, 1);
	assert.equal(find('data-test-project-tab').length, 2);
	first.projectDisplayName.value = 'first.gsproj';
	first.hasUnsavedChanges.value = true;
	second.isProjectSaving.value = true;
	await nextTick();
	assert.deepEqual(find('data-test-project-tab-name').map(node => node.text), ['first.gsproj', 'second.gsproj']);
	assert.equal(find('data-test-project-tab-unsaved').length, 1);
	assert.equal(find('data-test-project-tab-saving').length, 1);
	manager.fileOperations.isBusy.value = true;
	await nextTick();
	assert.equal(find('data-test-close-project').every(node => node.props.disabled === true), true);
	assert.notEqual(find('data-test-select-project')[1].props.disabled, true);
	find('data-test-select-project')[1].props.onClick();
	assert.equal(manager.activeSession.value, second);
	manager.fileOperations.isBusy.value = false;
	await nextTick();
	assert.equal(find('data-test-close-project').every(node => node.props.disabled === false), true);
	find('data-test-close-project')[0].props.onClick();
	await nextTick();
	assert.deepEqual(manager.sessions.value, [second]);
	assert.equal(find('data-test-project-tabs').length, 1);
});
