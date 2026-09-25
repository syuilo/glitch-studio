import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 実際のメニューとコマンドを使い、アプリ全体に依存する設定・エフェクト一覧だけ置き換える。
const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export { COMMAND_DEFS } from './src/commands.ts'; export { getNodeInputSamplingMenuItems } from './src/utility/input-sampling-menu.ts'; export { reactive, computed } from 'vue';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'sampling-menu-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: path === 'preferences'
			? 'export const preferences = { s: { forceTypeSafety: false } };'
			: "export const effectDefinitions = { test: { paramDefs: { inputs: { dataType: 'array', item: { dataType: 'color', canNode: true } } } } };",
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { getNodeInputSamplingMenuItems, COMMAND_DEFS, reactive, computed } = module.exports;

const sampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
function fixture() {
	const node = reactive({ id: 'node', type: 'effect', effectId: 'test', isBypass: false, params: { inputs: { inputSource: 'literal', value: [{ inputSource: 'node', nodeId: 'source', outputPort: 'output', ...sampling }] } } });
	const state = { visualModules: { value: [{ id: 'module', nodes: [node] }] } };
	const target = { visualModuleId: 'module', nodeId: 'node', paramPath: ['inputs', 0] };
	const commands = [];
	const read = () => node.params.inputs.value[0];
	// 実際の呼び出し元と同じく、接続済みの値をcomputedで渡す。
	const openMenu = () => getNodeInputSamplingMenuItems(computed(read), value => {
		const command = COMMAND_DEFS.updateParamAsNode.create({ ...target, value, preserveSampling: false });
		commands.push(command);
		command.execute(state);
	});
	return { state, target, commands, openMenu, read };
}

// 接続に保存された設定を表示し、配列内の入力に対する変更をUndo/Redoできる。
test('edits stored sampling settings through undoable commands', () => {
	const { openMenu, commands, state, read } = fixture();
	for (const [index, key, value] of [[0, 'fitMode', 'contain'], [1, 'wrapMode', 'transparent'], [2, 'filterMode', 'nearest']]) {
		const menu = openMenu();
		assert.equal(menu[index].ref.value, sampling[key]);
		menu[index].ref.value = value;
	}
	assert.deepEqual(read(), { inputSource: 'node', nodeId: 'source', outputPort: 'output', fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' });
	// メニュー表示中のUndoは仕様対象外なので、履歴操作後は新しいメニューで確認する。
	for (const command of [...commands].reverse()) command.undo(state);
	assert.deepEqual(openMenu().map(item => item.ref.value), ['cover', 'repeatMirrored', 'linear']);
	for (const command of commands) command.execute(state);
	assert.deepEqual(openMenu().map(item => item.ref.value), ['contain', 'transparent', 'nearest']);
});

// 配線候補が既定の設定を持っていても、再接続では受け取り側の設定を維持する。
test('preserves sampling when reconnecting to the same or another output', () => {
	const { openMenu, state, target, read } = fixture();
	openMenu()[0].ref.value = 'stretch';
	openMenu()[1].ref.value = 'repeat';
	openMenu()[2].ref.value = 'nearest';
	for (const nodeId of ['source', 'another']) {
		const before = { ...read() };
		const command = COMMAND_DEFS.updateParamAsNode.create({ ...target, value: { nodeId, outputPort: 'output', ...sampling }, preserveSampling: true });
		command.execute(state);
		assert.deepEqual(read(), { ...before, nodeId });
		command.undo(state);
		assert.deepEqual(read(), before);
		command.execute(state);
		assert.deepEqual(read(), { ...before, nodeId });
	}
});

// 切断後はサンプリングメニューを作らず、再接続時には新しい接続の設定を採用する。
test('uses supplied sampling after disconnecting and reconnecting', () => {
	const { openMenu, state, target, read } = fixture();
	openMenu()[2].ref.value = 'nearest';
	const disconnect = COMMAND_DEFS.updateParamAsNode.create({ ...target, value: null, preserveSampling: true });
	disconnect.execute(state);
	assert.deepEqual(read(), { inputSource: 'node', nodeId: null, outputPort: null });
	disconnect.undo(state);
	assert.equal(openMenu()[2].ref.value, 'nearest');
	disconnect.execute(state);
	COMMAND_DEFS.updateParamAsNode.create({ ...target, value: { nodeId: 'another', outputPort: 'output', ...sampling }, preserveSampling: true }).execute(state);
	assert.deepEqual(read(), { inputSource: 'node', nodeId: 'another', outputPort: 'output', ...sampling });
});
