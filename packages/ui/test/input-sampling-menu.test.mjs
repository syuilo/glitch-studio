import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 実際のメニューとコマンドを使い、アプリ全体に依存する設定・エフェクト一覧だけ置き換える。
const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export { COMMAND_DEFS } from './src/commands.ts'; export { inputSamplingMenu } from './src/utility/input-sampling-menu.ts'; export { reactive } from 'vue';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'sampling-menu-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.ts$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: path === 'preferences'
			? 'export const preferences = { s: { forceTypeSafety: false } };'
			: "export const effectDefinitions = { test: { paramDefs: { inputs: { dataType: 'array', item: { dataType: 'color', canNode: true } } } } };",
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { inputSamplingMenu, COMMAND_DEFS, reactive } = module.exports;

function fixture() {
	const node = reactive({ id: 'node', type: 'effect', effectId: 'test', params: { inputs: { inputSource: 'literal', value: [{ inputSource: 'node', nodeId: 'source', outputPort: 'output' }] } } });
	const state = { visualModules: { value: [{ id: 'module', nodes: [node] }] } };
	const target = { visualModuleId: 'module', nodeId: 'node', paramPath: ['inputs', 0] };
	const commands = [];
	const read = () => {
		const value = node.params.inputs.value[0];
		return value.inputSource === 'node' && value.nodeId != null ? value : null;
	};
	const menu = inputSamplingMenu(read, value => {
		const command = COMMAND_DEFS.updateParamAsNode.create({ ...target, value });
		commands.push(command);
		command.execute(state);
	});
	return { node, state, target, commands, menu, read };
}

// Filterの既定値・Undo/Redo・配線元変更時の保持と未接続時の無効化を確認する。
test('edits and preserves the input filter through undoable commands', () => {
	const { menu, commands, state, target, read } = fixture();
	assert.equal(menu[2].ref.value, 'linear');
	menu[2].ref.value = 'nearest';
	assert.equal(read().filterMode, 'nearest');
	commands[0].undo(state);
	assert.equal(menu[2].ref.value, 'linear');
	commands[0].execute(state);
	assert.equal(menu[2].ref.value, 'nearest');
	COMMAND_DEFS.updateParamAsNode.create({ ...target, value: { nodeId: 'another', outputPort: 'output' } }).execute(state);
	assert.equal(read().filterMode, 'nearest');
	COMMAND_DEFS.updateParamAsNode.create({ ...target, value: null }).execute(state);
	assert.equal(menu[2].disabled.value, true);
	menu[2].ref.value = 'linear';
	assert.equal(commands.length, 1);
	assert.equal(read(), null);
});

// 省略時の選択状態と、配列内のパラメータに対する変更・Undo/Redoを確認する。
test('edits sampling settings through undoable commands with the expected defaults', () => {
	const { menu, commands, state, read } = fixture();
	assert.equal(menu[0].ref.value, 'cover');
	assert.equal(menu[1].ref.value, 'repeatMirrored');
	assert.equal(menu[0].disabled.value, false);
	menu[0].ref.value = 'contain';
	menu[1].ref.value = 'transparent';
	assert.deepEqual(read(), { inputSource: 'node', nodeId: 'source', outputPort: 'output', fitMode: 'contain', wrapMode: 'transparent' });
	commands[1].undo(state);
	assert.equal(menu[1].ref.value, 'repeatMirrored');
	commands[0].undo(state);
	assert.equal(menu[0].ref.value, 'cover');
	commands[0].execute(state);
	commands[1].execute(state);
	assert.equal(menu[0].ref.value, 'contain');
	assert.equal(menu[1].ref.value, 'transparent');
});

// メニュー表示後に切断されても古い接続を復活させず、配線元変更では設定を維持する。
test('preserves settings on reconnection and disables disconnected inputs', () => {
	const { node, menu, state, target, read, commands } = fixture();
	menu[0].ref.value = 'stretch';
	menu[1].ref.value = 'repeat';
	COMMAND_DEFS.updateParamAsNode.create({ ...target, value: { nodeId: 'another', outputPort: 'secondary' } }).execute(state);
	assert.deepEqual(read(), { inputSource: 'node', nodeId: 'another', outputPort: 'secondary', fitMode: 'stretch', wrapMode: 'repeat' });
	COMMAND_DEFS.updateParamAsNode.create({ ...target, value: null }).execute(state);
	assert.equal(menu[0].disabled.value, true);
	menu[0].ref.value = 'contain';
	assert.equal(commands.length, 2);
	assert.equal(read(), null);
	node.params.inputs.value[0] = { inputSource: 'literal', value: [1, 0, 0, 1] };
	assert.equal(menu[1].disabled.value, true);
});
