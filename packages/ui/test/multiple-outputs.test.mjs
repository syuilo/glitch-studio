import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('UI multi-output connections', async t => {
	const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
	t.after(() => server.close());
	const { COMMAND_DEFS } = await server.ssrLoadModule('/src/commands.ts');
	const { fxDefinitions } = await server.ssrLoadModule('@glitch/shared/effect-definitions.ts');
	fxDefinitions.multiTest = { displayName: 'Multi', paramDefs: {}, outputs: { output: { dataType: 'color', primary: true }, subOutput: { dataType: 'scalar', primary: false } } };
	const ref = (nodeId, outputPort = 'output') => ({ nodeId, outputPort });
	const fx = (id, name = 'multiTest', params = {}) => ({ id, type: 'effect', effectId: name, isBypass: true, params });
	const group = (id, nodes) => ({ id, type: 'group', name: id, nodes, macros: [], isBypass: true });
	const state = nodes => ({ nodes: { value: nodes } });
	await t.test('automatic connection records the primary port of the previous node or group', () => {
		for (const previous of [fx('a'), group('g', [group('inner', [fx('a')])])]) {
			const s = state([previous]);
			const command = COMMAND_DEFS.addEffectNode.create({ id: 'b', effectId: 'multiply' });
			command.execute(s);
			assert.deepEqual(s.nodes.value[1].params.input, { type: 'literal', value: ref(previous.id) });
			command.undo(s);
			assert.equal(s.nodes.value.length, 1);
		}
	});
	await t.test('changing a node-driven parameter preserves its port through undo and redo', () => {
		const before = { type: 'node', nodeId: null, outputPort: null };
		const s = state([fx('b', 'multiply', { input: before })]);
		const command = COMMAND_DEFS.updateParamAsNode.create({ nodeId: 'b', param: 'input', value: ref('a', 'subOutput') });
		command.execute(s);
		assert.deepEqual(s.nodes.value[0].params.input, { type: 'node', ...ref('a', 'subOutput') });
		command.undo(s);
		assert.deepEqual(s.nodes.value[0].params.input, before);
		command.execute(s);
		assert.equal(s.nodes.value[0].params.input.outputPort, 'subOutput');
	});
	await t.test('removal reconnects literal and node-driven inputs to the original upstream port', () => {
		const s = state([fx('a'), fx('b', 'multiply', { input: { type: 'literal', value: ref('a', 'subOutput') } }), fx('c', 'blur', { input: { type: 'literal', value: ref('b') }, amount: { type: 'node', ...ref('b') } })]);
		const command = COMMAND_DEFS.removeNode.create({ nodeId: 'b' });
		command.execute(s);
		assert.deepEqual(s.nodes.value[1].params.input.value, ref('a', 'subOutput'));
		assert.deepEqual(s.nodes.value[1].params.amount, { type: 'node', ...ref('a', 'subOutput') });
		command.undo(s);
		assert.deepEqual(s.nodes.value[2].params.amount, { type: 'node', ...ref('b') });
	});
	await t.test('removing a group clears references to all descendants with both fields null', () => {
		const s = state([group('g', [fx('a')]), fx('c', 'blur', { input: { type: 'literal', value: ref('g') }, amount: { type: 'node', ...ref('a', 'subOutput') } })]);
		COMMAND_DEFS.removeNode.create({ nodeId: 'g' }).execute(s);
		assert.equal(s.nodes.value[0].params.input.value, null);
		assert.deepEqual(s.nodes.value[0].params.amount, { type: 'node', nodeId: null, outputPort: null });
	});
	await t.test('switching parameter modes clears both fields and can be undone', () => {
		const original = { type: 'literal', value: 0.5 };
		const s = state([fx('b', 'blur', { amount: original })]);
		const command = COMMAND_DEFS.changeParamValueType.create({ nodeId: 'b', param: 'amount', type: 'node' });
		command.execute(s);
		assert.deepEqual(s.nodes.value[0].params.amount, { type: 'node', nodeId: null, outputPort: null });
		command.undo(s);
		assert.deepEqual(s.nodes.value[0].params.amount, original);
		command.execute(s);
		COMMAND_DEFS.changeParamValueType.create({ nodeId: 'b', param: 'amount', type: 'literal' }).execute(s);
		assert.equal(typeof s.nodes.value[0].params.amount.value, 'number');
	});
	await t.test('clearing a connection and undoing restores the full port reference', () => {
		const original = { type: 'node', ...ref('a', 'subOutput') };
		const s = state([fx('b', 'blur', { amount: original })]);
		const command = COMMAND_DEFS.updateParamAsNode.create({ nodeId: 'b', param: 'amount', value: null });
		command.execute(s);
		assert.deepEqual(s.nodes.value[0].params.amount, { type: 'node', nodeId: null, outputPort: null });
		command.undo(s);
		assert.deepEqual(s.nodes.value[0].params.amount, original);
	});
	await t.test('menus flatten every port, retain stable select keys, and expose group ports', async () => {
		const { getNodeOutputItems, nodeOutputKey } = await server.ssrLoadModule('/src/utility/node-outputs.ts');
		const nodes = [fx('a'), group('g', [fx('b')]), fx('self')];
		const items = getNodeOutputItems(nodes, 'self');
		assert.deepEqual(items.map(i => i.label), ['Multi [a]: output', 'Multi [a]: subOutput', 'g [g]: output', 'g [g]: subOutput', 'Multi [b]: output', 'Multi [b]: subOutput']);
		assert.equal(items[1].value, nodeOutputKey(ref('a', 'subOutput')));
		assert.deepEqual(items[1].connection, ref('a', 'subOutput'));
	});
});
