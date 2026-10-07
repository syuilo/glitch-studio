import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bundled = await build({
	stdin: { contents: `
		export * from './src/utility/workspace-panel-reveal.ts';
		export { WorkspaceController } from './src/WorkspaceController.ts';
		export { shallowRef, effectScope } from 'vue';
	`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { findWorkspacePanelRevealPlan, WorkspaceController, shallowRef, effectScope } = module.exports;
const panel = (id, contentType = 'timelineSubPanel', collapsed = false) => ({ id, type: 'panel', direction: 'horizontal', contentType, collapsed });
const tabs = (id, children, collapsed = false) => ({ id, type: 'tabs', direction: 'horizontal', children: children.map(element => ({ name: element.id, element })), collapsed });
const divider = (id, children) => ({ id, type: 'divider', direction: 'horizontal', children: children.map(element => ({ ratio: 1 / children.length, element })) });
const source = () => panel('source', 'timeline');
const request = { contentType: 'timelineSubPanel', sourcePanelId: 'source' };
const find = (root, selections = new Map(), override = request) => findWorkspacePanelRevealPlan(root, selections, override);

// 【祖先タブで操作元を隠す候補を除外する】
// 直近の親が分割でも、共通祖先の別タブを開くとタイムラインが消える。
// 同じタブ内の分割にある候補なら安全に開けることも確認する。
test('excludes conflicting ancestor tabs but allows a split in the same tab', () => {
	const root = tabs('outer', [divider('work', [source(), panel('safe', 'timelineSubPanel', true)]), divider('other', [panel('unsafe')])]);
	assert.deepEqual(find(root), { panelId: 'safe', tabSelections: [], expandIds: ['safe'] });
	assert.equal(find(tabs('outer', [divider('work', [source()]), panel('unsafe')])), null);
});

// 【表示中・変更数・ツリー順の順に候補を選ぶ】
// 自動展開で不要なタブ切り替えが起きないようにし、同点の結果も安定させる。
test('ranks candidates by visibility then change count with stable ties', () => {
	const root = divider('root', [source(), tabs('hidden', [panel('blank', 'blank'), panel('costly')], true), panel('cheap', 'timelineSubPanel', true), panel('visible')]);
	assert.equal(find(root).panelId, 'visible');
	root.children.pop();
	assert.equal(find(root).panelId, 'cheap');
	root.children.push({ ratio: 1, element: panel('alsoCheap', 'timelineSubPanel', true) });
	assert.equal(find(root).panelId, 'cheap');
});

// 【未マウントの入れ子タブを含む全経路を計画する】
// DOMやコンポーネントが存在しない候補でも、祖先の選択と折りたたみ解除が必要になる。
// 探索によって保存定義や選択状態を書き換えてはいけない。
test('plans nested selections and expansion without mutating inputs', () => {
	const root = divider('root', [source(), tabs('outer', [panel('blank', 'blank'), divider('branch', [tabs('inner', [panel('blank2', 'blank'), divider('leaf', [panel('target', 'timelineSubPanel', true)])], true)])], true)]);
	const before = structuredClone(root);
	const selections = new Map();
	assert.deepEqual(find(root, selections), {
		panelId: 'target', tabSelections: [{ tabsId: 'outer', childId: 'branch' }, { tabsId: 'inner', childId: 'leaf' }], expandIds: ['outer', 'inner', 'target'],
	});
	assert.deepEqual(root, before);
	assert.equal(selections.size, 0);
});

// 【存在しない操作元や候補では何もしない】
// 古いパネルIDからの要求で意図しない場所を開かず、他の種類のパネルにも同じ探索を使える。
test('handles absent panels and supports other content types', () => {
	assert.equal(find(divider('root', [source()])), null);
	assert.equal(find(panel('target')), null);
	const root = divider('root', [source(), panel('assets', 'assets')]);
	assert.equal(find(root, new Map(), { ...request, contentType: 'assets' }).panelId, 'assets');
});

// 【折りたたみ不能な位置のフラグを表示コストに含めない】
// 移動前のcollapsedが残っていても、実際のコンポーネントと同じ表示判定にする。
test('ignores collapse flags outside divider children', () => {
	const root = tabs('outer', [divider('split', [source(), tabs('inner', [panel('target', 'timelineSubPanel', true)])])], true);
	assert.deepEqual(find(root), { panelId: 'target', tabSelections: [], expandIds: [] });
});

function withController(root, run) {
	const scope = effectScope();
	try {
		scope.run(() => {
			const state = shallowRef(root);
			const commits = [];
			const controller = new WorkspaceController(state, value => { commits.push(value); state.value = value; });
			run(controller, state, commits);
		});
	} finally { scope.stop(); }
}

// 【非表示のタブも選択し、表示済みの要求は保存を発生させない】
// イベント購読者のマウントを待たずに開けることと、再選択時の不要な保存を防ぐことを保証する。
// 手動で閉じた後は、明示的な次の要求まで閉じたままにする。
test('reveals unmounted tabs and respects manual collapse until another request', () => {
	const root = divider('root', [source(), tabs('outer', [panel('blank', 'blank'), tabs('inner', [panel('blank2', 'blank'), panel('target')])], true)]);
	withController(root, (controller, state, commits) => {
		assert.equal(controller.findVisiblePanel(request), null);
		assert.equal(controller.revealPanel(request), 'target');
		assert.equal(controller.findVisiblePanel(request), 'target');
		assert.equal(commits.length, 1);
		controller.revealPanel(request);
		assert.equal(commits.length, 1);
		const closed = structuredClone(state.value);
		closed.children[1].element.collapsed = true;
		state.value = closed;
		assert.equal(controller.findVisiblePanel(request), null);
		assert.equal(state.value.children[1].element.collapsed, true);
		controller.revealPanel(request);
		assert.equal(controller.findVisiblePanel(request), 'target');
	});
});

// 【タブを削除した際には同じ位置を選び、再作成には古い選択を持ち込まない】
// 選択の所有者を移しても従来の削除・分割時の挙動を維持し、削除済みIDは解放する。
test('reconciles selection on replacement and removes stale tab state', () => {
	withController(tabs('root', [panel('a'), panel('b'), panel('c')]), (controller, state) => {
		controller.selectTab('root', 'b');
		state.value = tabs('root', [panel('a'), panel('replacement'), panel('c')]);
		assert.equal(controller.getSelectedTabId(state.value), 'replacement');
		controller.selectTab('root', 'c');
		state.value = tabs('root', [panel('a'), panel('replacement')]);
		assert.equal(controller.getSelectedTabId(state.value), 'replacement');
		state.value = panel('temporary');
		state.value = tabs('root', [panel('a'), panel('replacement')]);
		assert.equal(controller.getSelectedTabId(state.value), 'a');
	});
});
