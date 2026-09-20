import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestServer } from './helpers/server.mjs';

test('UI multi-output connections', async t => {
	const server = await createTestServer(t);
	const { COMMAND_DEFS } = await server.ssrLoadModule('/src/commands.ts');
	const { effectDefinitions: fxDefinitions } = await server.ssrLoadModule('@glitch/shared/effect-definitions.ts');
	fxDefinitions.multiTest = { displayName: 'Multi', paramDefs: {}, outputs: { output: { dataType: 'color', primary: true }, subOutput: { dataType: 'scalar', primary: false } } };
	const ref = (nodeId, outputPort = 'output') => ({ nodeId, outputPort });
	const fx = (id, name = 'multiTest', params = {}) => ({ id, type: 'effect', effectId: name, isBypass: true, params });
	const state = nodes => ({ visualModules: { value: [{ id: 'module', nodes, paramDefs: [], outputDefs: [{ id: 'result', name: 'Result', dataType: 'color', isPrimaryOutput: true }] }] } });
	const nodes = s => s.visualModules.value[0].nodes;
	await t.test('automatic connection inserts a node before Out and preserves its upstream port', () => {
		for (const previous of [fx('a')]) {
			const s = state([previous, { id: 'out', type: 'globalOut', inputs: { result: ref(previous.id) } }]);
			const command = COMMAND_DEFS.addEffectNode.create({ visualModuleId: 'module', id: 'b', effectId: 'blur' });
			command.execute(s);
			assert.deepEqual(nodes(s)[1].params.input, { type: 'node', ...ref(previous.id) });
			command.undo(s);
			assert.equal(nodes(s).length, 2);
		}
	});
	await t.test('changing a node-driven parameter preserves its port through undo and redo', () => {
		const before = { type: 'node', nodeId: null, outputPort: null };
		const s = state([fx('b', 'blur', { input: before })]);
		const command = COMMAND_DEFS.updateParamAsNode.create({ visualModuleId: 'module', nodeId: 'b', paramPath: ['input'], value: ref('a', 'subOutput') });
		command.execute(s);
		assert.deepEqual(nodes(s)[0].params.input, { type: 'node', ...ref('a', 'subOutput') });
		command.undo(s);
		assert.deepEqual(nodes(s)[0].params.input, before);
		command.execute(s);
		assert.equal(nodes(s)[0].params.input.outputPort, 'subOutput');
	});
	await t.test('removal reconnects inputs to the original upstream port', () => {
		const s = state([fx('a'), fx('b', 'blur', { input: { type: 'node', ...ref('a', 'subOutput') } }), fx('c', 'blur', { input: { type: 'node', ...ref('b') }, amount: { type: 'node', ...ref('b') } })]);
		const command = COMMAND_DEFS.removeNode.create({ visualModuleId: 'module', nodeId: 'b' });
		command.execute(s);
		assert.deepEqual(nodes(s)[1].params.input, { type: 'node', ...ref('a', 'subOutput') });
		assert.deepEqual(nodes(s)[1].params.amount, { type: 'node', ...ref('a', 'subOutput') });
		command.undo(s);
		assert.deepEqual(nodes(s)[2].params.amount, { type: 'node', ...ref('b') });
	});
	await t.test('removing a source clears node and Out references and undo restores them', () => {
		const s = state([fx('a'), fx('c', 'blur', { input: { type: 'node', ...ref('a') }, amount: { type: 'node', ...ref('a', 'subOutput') } }), { id: 'out', type: 'globalOut', inputs: { result: ref('a') } }]);
		const command = COMMAND_DEFS.removeNode.create({ visualModuleId: 'module', nodeId: 'a' });
		command.execute(s);
		assert.deepEqual(nodes(s)[0].params.input, { type: 'node', nodeId: null, outputPort: null });
		assert.deepEqual(nodes(s)[1].inputs.result, { nodeId: null, outputPort: null });
		command.undo(s);
		assert.deepEqual(nodes(s)[2].inputs.result, ref('a'));
	});
	await t.test('switching parameter modes clears both fields and can be undone', () => {
		const original = { inputSource: 'literal', value: 0.5 };
		const s = state([fx('b', 'blur', { amount: original })]);
		const command = COMMAND_DEFS.changeParamValueInputSource.create({ visualModuleId: 'module', nodeId: 'b', paramPath: ['amount'], type: 'node' });
		command.execute(s);
		assert.deepEqual(nodes(s)[0].params.amount, { type: 'node', nodeId: null, outputPort: null });
		command.undo(s);
		assert.deepEqual(nodes(s)[0].params.amount, original);
		command.execute(s);
		COMMAND_DEFS.changeParamValueInputSource.create({ visualModuleId: 'module', nodeId: 'b', paramPath: ['amount'], inputSource: 'literal' }).execute(s);
		assert.equal(typeof nodes(s)[0].params.amount.value, 'number');
	});
	await t.test('clearing a connection and undoing restores the full port reference', () => {
		const original = { type: 'node', ...ref('a', 'subOutput') };
		const s = state([fx('b', 'blur', { amount: original })]);
		const command = COMMAND_DEFS.updateParamAsNode.create({ visualModuleId: 'module', nodeId: 'b', paramPath: ['amount'], value: null });
		command.execute(s);
		assert.deepEqual(nodes(s)[0].params.amount, { type: 'node', nodeId: null, outputPort: null });
		command.undo(s);
		assert.deepEqual(nodes(s)[0].params.amount, original);
	});
	await t.test('menus expose every port and retain stable select keys', async () => {
		const { getNodeOutputItems, nodeOutputKey } = await server.ssrLoadModule('/src/utility/node-outputs.ts');
		const nodes = [fx('a'), fx('b'), fx('self')];
		const items = getNodeOutputItems(nodes, 'self');
		assert.deepEqual(items.map(i => i.label), ['Multi [a]: output', 'Multi [a]: subOutput', 'Multi [b]: output', 'Multi [b]: subOutput']);
		assert.equal(items[1].value, nodeOutputKey(ref('a', 'subOutput')));
		assert.deepEqual(items[1].connection, ref('a', 'subOutput'));
	});
});
