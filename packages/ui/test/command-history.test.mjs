import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { ref, shallowRef, triggerRef, computed } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { createTestServer } from './helpers/server.mjs';

// Load commands without starting the renderer or the browser application.
const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const server = await createTestServer({ after: fn => test.after(fn) });
const { COMMAND_DEFS } = await server.ssrLoadModule('/src/commands.ts');
const { effectDefinitions } = await server.ssrLoadModule('@glitch/shared/effect-definitions.ts');
effectDefinitions.test = { paramDefs: { xy: { type: 'vector', default: () => ({ inputSource: 'literal', value: [0, 0] }) } }, outputs: {} };
const compiled = ts.transpileModule(source.slice(source.indexOf('class AppContext'), source.indexOf('export const appContext')), {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const AppContext = new Function('ref', 'shallowRef', 'triggerRef', 'computed', 'deepClone', 'COMMAND_DEFS', 'console', compiled + '\nreturn AppContext;')(ref, shallowRef, triggerRef, computed, deepClone, COMMAND_DEFS, { log() {} });
const macroCommand = COMMAND_DEFS.updateMacroAsLiteral;
function setup() {
	const app = new AppContext();
	app.state.visualModules.value.push({ id: 'module', name: 'Test', nodes: [], paramDefs: [], outputDefs: [] });
	return app;
}

test('node creation keeps supplied and default parameters separate from state', () => {
	const app = setup();
	app.commit('addEffectNode', { visualModuleId: 'module', id: 'n', effectId: 'test', params: { supplied: { inputSource: 'literal', value: [1, 2] } } });
	const nodes = () => app.state.visualModules.value[0].nodes;
	nodes()[0].params.supplied.value[0] = 99;
	nodes()[0].params.xy.value[0] = 99;
	app.undo();
	app.redo();
	assert.deepEqual(nodes()[0].params.supplied.value, [1, 2]);
	assert.deepEqual(nodes()[0].params.xy.value, [0, 0]);
});


test('asset bytes are isolated and file data remains a Blob', async () => {
	for (const type of ['addAsset', 'replaceAsset']) {
		const app = setup();
		if (type === 'replaceAsset') app.state.assets.value.push({ id: 'a' });
		app.commit(type, { id: 'a', assetId: 'a', data: new Uint8Array([1]), fileData: new Blob([new Uint8Array([2])]) });
		const command = app.undoStack.value.at(-1);
		app.state.assets.value[0].data[0] = 99;
		if (type === 'addAsset') app.undo();
		command.execute(app.state);
		assert.equal(app.state.assets.value[0].data[0], 1);
		assert.ok(app.state.assets.value[0].fileData instanceof Blob);
		assert.deepEqual([...new Uint8Array(await app.state.assets.value[0].fileData.arrayBuffer())], [2]);
	}
});

test('macro values and type options are isolated on every application', () => {
	const app = setup();
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
	const app = setup();
	app.commit('addEffectNode', { visualModuleId: 'module', id: 'n', effectId: 'test' });
	for (const value of [[1, 1], [2, 2]]) app.commit('updateParamAsLiteral', { visualModuleId: 'module', nodeId: 'n', paramPath: ['xy'], value }, 'drag');
	app.state.visualModules.value[0].nodes[0].params.xy.value[0] = 99;
	app.undo();
	assert.deepEqual(app.state.visualModules.value[0].nodes[0].params.xy.value, [0, 0]);
	app.state.visualModules.value[0].nodes[0].params.xy.value[0] = 99;
	app.redo();
	assert.deepEqual(app.state.visualModules.value[0].nodes[0].params.xy.value, [2, 2]);
	app.undo();
	assert.deepEqual(app.state.visualModules.value[0].nodes[0].params.xy.value, [0, 0]);
});
