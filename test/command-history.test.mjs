import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { ref, shallowRef, triggerRef } from 'vue';
import { deepClone } from '../src/utility/deep-clone.ts';

// Load commands without starting the renderer or the browser application.
const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const commandsSource = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const code = commandsSource.slice(commandsSource.indexOf('function defineCommand')) + '\n'
	+ source.slice(source.indexOf('class AppContext'), source.indexOf('export const appContext'));
const compiled = ts.transpileModule(code.replace('export const COMMAND_DEFS', 'const COMMAND_DEFS'), {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const defaults = { xy: { type: 'literal', value: [0, 0] } };
const { AppContext, macroCommand } = new Function('ref', 'shallowRef', 'triggerRef', 'deepClone', 'fxs', 'console',
	compiled + '\nreturn { AppContext, macroCommand: updateMacroAsLiteralCommandDef };',
)(ref, shallowRef, triggerRef, deepClone, { test: { paramDefs: { xy: {} }, getDefaultParams: () => defaults } }, { log() {} });

test('node creation keeps supplied and default parameters separate from state', () => {
	for (const groupId of [undefined, 'group']) {
		const app = new AppContext();
		if (groupId) app.commit('addGroupNode', { id: groupId });
		app.commit('addEffectNode', { id: 'n', effectId: 'test', groupId, params: { supplied: { type: 'literal', value: [1, 2] } } });
		const nodes = () => groupId ? app.state.nodes.value[0].nodes : app.state.nodes.value;
		nodes()[0].params.supplied.value[0] = 99;
		nodes()[0].params.xy.value[0] = 99;
		app.undo();
		app.redo();
		assert.deepEqual(nodes()[0].params.supplied.value, [1, 2]);
		assert.deepEqual(nodes()[0].params.xy.value, [0, 0]);
	}
});

test('group names can be changed, undone and redone, including nested groups', () => {
	const app = new AppContext();
	app.commit('addGroupNode', { id: 'parent' });
	app.commit('addGroupNode', { id: 'child', groupId: 'parent' });
	for (const group of [app.state.nodes.value[0], app.state.nodes.value[0].nodes[0]]) {
		const before = group.name;
		app.commit('updateGroupName', { nodeId: group.id, name: 'Renamed' });
		assert.equal(group.name, 'Renamed');
		app.undo();
		assert.equal(group.name, before);
		app.redo();
		assert.equal(group.name, 'Renamed');
	}
});

test('asset byte arrays are not shared with command payloads', () => {
	for (const type of ['addAsset', 'replaceAsset']) {
		const app = new AppContext();
		if (type === 'replaceAsset') app.state.assets.value.push({ id: 'a' });
		app.commit(type, { id: 'a', assetId: 'a', data: new Uint8Array([1]), fileData: new Uint8Array([2]) });
		const command = app.undoStack.value.at(-1);
		app.state.assets.value[0].data[0] = 99;
		app.state.assets.value[0].fileData[0] = 99;
		if (type === 'addAsset') app.undo();
		command.execute(app.state);
		assert.equal(app.state.assets.value[0].data[0], 1);
		assert.equal(app.state.assets.value[0].fileData[0], 2);
	}
});

test('macro values and type options are isolated on every application', () => {
	const app = new AppContext();
	app.commit('addMacro', { id: 'm' });
	const macro = app.state.macros.value[0];
	const command = macroCommand.create({ macroId: 'm', value: [1, 2] });
	command.execute(app.state);
	macro.value.value[0] = 99;
	command.execute(app.state);
	assert.deepEqual(macro.value.value, [1, 2]);
	app.commit('updateMacroTypeOption', { macroId: 'm', key: 'options', value: [{ value: 1 }] });
	macro.typeOptions.options[0].value = 99;
	app.undoStack.value.at(-1).execute(app.state);
	assert.equal(macro.typeOptions.options[0].value, 1);
});

test('merged parameter history preserves both endpoints across repeated undo/redo', () => {
	const app = new AppContext();
	app.commit('addEffectNode', { id: 'n', effectId: 'test' });
	for (const value of [[1, 1], [2, 2]]) app.commit('updateParamAsLiteral', { nodeId: 'n', param: 'xy', value }, 'drag');
	app.state.nodes.value[0].params.xy.value[0] = 99;
	app.undo();
	assert.deepEqual(app.state.nodes.value[0].params.xy.value, [0, 0]);
	app.state.nodes.value[0].params.xy.value[0] = 99;
	app.redo();
	assert.deepEqual(app.state.nodes.value[0].params.xy.value, [2, 2]);
	app.undo();
	assert.deepEqual(app.state.nodes.value[0].params.xy.value, [0, 0]);
});
