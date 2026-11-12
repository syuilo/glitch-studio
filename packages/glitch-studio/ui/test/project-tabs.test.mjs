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

// 【単一プロジェクトではタブを隠し、追加・切替・終了と未保存状態を実コンポーネントへ反映する】
// セッション数だけをテストしても、UIの表示条件・イベント接続の間違いは見つからない。
// 二つから一つへ戻る場合も同じ条件で非表示になることを確認する。
test('shows tabs only for multiple projects and routes selection and close to their owners', async t => {
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
	const session = id => ({ id, projectContext: { stateManager: { state: { name: ref(id) } } }, hasUnsavedChanges: ref(false), isProjectSaving: ref(false) });
	const first = session('first');
	const second = session('second');
	const manager = { sessions: shallowRef([first]), activeSession: shallowRef(first),
		select(target) { this.activeSession.value = target; }, close(target) { this.sessions.value = this.sessions.value.filter(session => session !== target); } };
	const root = element();
	let additions = 0;
	const app = renderer.createApp({ render: () => h(Tabs, { manager, onNewProject: () => { additions++; } }) });
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
	assert.equal(find('data-test-project-tabs').length, 0);
	manager.sessions.value = [first, second];
	await nextTick();
	assert.equal(find('data-test-project-tabs').length, 1);
	assert.equal(find('data-test-project-tab').length, 2);
	first.hasUnsavedChanges.value = true;
	second.isProjectSaving.value = true;
	await nextTick();
	assert.equal(find('data-test-project-tab-unsaved').length, 1);
	assert.equal(find('data-test-project-tab-saving').length, 1);
	find('data-test-select-project')[1].props.onClick();
	assert.equal(manager.activeSession.value, second);
	find('data-test-new-project')[0].props.onClick();
	assert.equal(additions, 1);
	find('data-test-close-project')[0].props.onClick();
	await nextTick();
	assert.deepEqual(manager.sessions.value, [second]);
	assert.equal(find('data-test-project-tabs').length, 0);
});
