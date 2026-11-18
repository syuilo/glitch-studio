import { prepareTestCommand } from './helpers/prepared-command.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	stdin: {
		contents: "export { COMMAND_DEFS } from './commands.ts'; export { getNodeOutputItems } from './utility/node-outputs.ts';",
		resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'auto-connect-dependencies', setup(build) {
		build.onResolve({ filter: /preferences\.ts$|effect-definitions\.[jt]s$/ }, ({ path }) => ({ path, external: true }));
	} }],
});

function fixture(enabled = false, inline = false) {
	const preferences = { s: { visualModuleAutoConnectOnNodeAdd: enabled, forceTypeSafety: true } };
	const disconnected = { inputSource: 'node', nodeId: null, outputPort: null };
	const effectDefinitions = {
		previous: { paramDefs: {}, outputDefs: { main: { dataType: { kind: 'color' } }, secondary: { dataType: { kind: 'color' } } } },
		filter: { primaryInputParameter: 'image', primaryOutput: 'result',
			paramDefs: { image: { canNode: true, dataType: { kind: 'color' }, defaultValue: disconnected } },
			outputDefs: { result: { dataType: { kind: 'color' } } } },
		scalar: { primaryInputParameter: 'value', primaryOutput: 'result',
			paramDefs: { value: { canNode: true, dataType: { kind: 'scalar' }, defaultValue: disconnected } },
			outputDefs: { result: { dataType: { kind: 'scalar' } } } },
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(path => /preferences\.ts$/.test(path)
		? { preferences } : /effect-definitions\.[jt]s$/.test(path) ? { effectDefinitions } : require(path), module, module.exports);
	const visualModule = { customParameterDefs: [], customParameterValues: {}, id: 'visual-module', paramDefs: [], primaryOutputId: 'primary', outputDefs: [
		{ id: 'primary', dataType: { kind: 'color' } }, { id: 'other', dataType: { kind: 'color' } },
	], nodes: [
		{ id: 'previous', type: 'effect', effectId: 'previous', params: {} },
		{ id: 'out', type: 'globalOut', inputs: {
			primary: { nodeId: 'previous', outputPort: 'secondary' }, other: { nodeId: 'previous', outputPort: 'main' },
		} },
	] };
	const state = { visualModules: { value: inline ? [] : [visualModule] },
		timelineScenes: { value: [{ id: 'scene', layers: [{ id: 'inline', layerType: 'inlineVisualModule', visualModule }] }] } };
	const target = inline ? { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' } : { visualModuleId: 'visual-module' };
	const command = (payload = {}) => prepareTestCommand(module.exports.COMMAND_DEFS.createVisualModuleEffectNode, { visualModule: target, effectId: 'filter', connectionMode: enabled ? 'appendToPrimaryOutput' : 'none', ...payload });
	return { preferences, visualModule, state, command, disconnected, target, definitions: module.exports.COMMAND_DEFS, getNodeOutputItems: module.exports.getNodeOutputItems };
}

// 【自動接続を無効にした追加では既存の配線と入力の既定値を維持する】
// 従来の追加操作を既定の挙動として保ち、後から設定を有効にしてもRedoで接続が増えないようにする。
test('preserves wiring when disabled even after enabling before redo', () => {
	const f = fixture();
	const before = structuredClone(f.visualModule);
	const command = f.command();
	const added = command.execute(f.state);
	assert.deepEqual(f.visualModule.nodes[1].params.image, f.disconnected);
	assert.deepEqual(f.visualModule.nodes.at(-1).inputs, before.nodes.at(-1).inputs);
	const after = structuredClone(f.visualModule);
	command.undo(f.state);
	assert.deepEqual(f.visualModule, before);
	f.preferences.s.visualModuleAutoConnectOnNodeAdd = true;
	assert.equal(command.execute(f.state).nodeId, added.nodeId);
	assert.deepEqual(f.visualModule, after);
});

// 【登録済み・インラインの主出力を追加ノードへ繋ぎ、副出力の接続元も維持する】
// 主出力以外の配線を変えず、Undoで元へ戻す。設定を無効にしてもRedoは追加時の接続を復元する。
test('connects primary ports and preserves secondary source ports through undo and redo', () => {
	for (const inline of [false, true]) {
		const f = fixture(true, inline);
		const before = structuredClone(f.visualModule);
		const command = f.command();
		const added = command.execute(f.state);
		assert.deepEqual(f.visualModule.nodes.map(node => node.id), ['previous', added.nodeId, 'out']);
		assert.deepEqual(f.visualModule.nodes[1].params.image, { inputSource: 'node', nodeId: 'previous', outputPort: 'secondary',
			fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
		assert.deepEqual(f.visualModule.nodes.at(-1).inputs.primary, { nodeId: added.nodeId, outputPort: 'result' });
		assert.deepEqual(f.visualModule.nodes.at(-1).inputs.other, before.nodes.at(-1).inputs.other);
		const after = structuredClone(f.visualModule);
		command.undo(f.state);
		assert.deepEqual(f.visualModule, before);
		f.preferences.s.visualModuleAutoConnectOnNodeAdd = false;
		assert.equal(command.execute(f.state).nodeId, added.nodeId);
		assert.deepEqual(f.visualModule, after);
	}
});

// 【未接続・主出力なしでも追加でき、Undoで接続の未設定と明示的な解除を復元する】
// 初めて出力へ接続する場合や主出力を使わないVisual Moduleでも、追加前の状態を失わないようにする。
test('handles missing and disconnected primary outputs without losing their original state', () => {
	for (const mode of ['missing', 'disconnected', 'noPrimary', 'noGlobalOut']) {
		const f = fixture(true);
		if (mode === 'missing') delete f.visualModule.nodes.at(-1).inputs.primary;
		if (mode === 'disconnected') f.visualModule.nodes.at(-1).inputs.primary = { nodeId: null, outputPort: null };
		if (mode === 'noPrimary') f.visualModule.primaryOutputId = null;
		if (mode === 'noGlobalOut') f.visualModule.nodes.pop();
		const before = structuredClone(f.visualModule);
		const command = f.command();
		const added = command.execute(f.state);
		assert.deepEqual(f.visualModule.nodes.find(node => node.id === added.nodeId).params.image, f.disconnected);
		if (mode === 'missing' || mode === 'disconnected') {
			assert.deepEqual(f.visualModule.nodes.at(-1).inputs.primary, { nodeId: added.nodeId, outputPort: 'result' });
		}
		command.undo(f.state);
		assert.deepEqual(f.visualModule, before);
	}
});

// 【型安全設定と明示的な入力値を尊重する】
// 自動接続で接続不能な入力・出力や、呼び出し側が指定した入力値を上書きしないようにする。
test('respects incompatible data types and explicitly supplied parameters', () => {
	const f = fixture(true);
	const inputs = structuredClone(f.visualModule.nodes.at(-1).inputs);
	f.command({ effectId: 'scalar' }).execute(f.state);
	assert.deepEqual(f.visualModule.nodes[1].params.value, f.disconnected);
	assert.deepEqual(f.visualModule.nodes.at(-1).inputs, inputs);
	const explicit = fixture(true);
	explicit.command({ parameters: { image: explicit.disconnected } }).execute(explicit.state);
	assert.deepEqual(explicit.visualModule.nodes[1].params.image, explicit.disconnected);
});

// 【Commandは環境設定を参照せず、明示した接続方針だけを適用する】
// スクリプトが同じ入力から同じプロジェクト編集を行えるよう、UI設定を有効にしても
// 未指定の生成では配線しない。検証が失敗してもノードや出力を途中まで変更しない。
test('uses explicit connection policy and validates creation before mutating the graph', () => {
	const f = fixture(true);
	const before = structuredClone(f.visualModule);
	const prepared = f.definitions.createVisualModuleEffectNode.prepare(f.state, { visualModule: f.target, effectId: 'filter' });
	assert.deepEqual(f.visualModule, before);
	prepared.change.apply(f.state);
	assert.deepEqual(f.visualModule.nodes[1].params.image, f.disconnected);
	assert.deepEqual(f.visualModule.nodes.at(-1).inputs, before.nodes.at(-1).inputs);
	prepared.change.revert(f.state);
	assert.deepEqual(f.visualModule, before);
	assert.throws(() => f.definitions.createVisualModuleEffectNode.prepare(f.state, { visualModule: f.target, effectId: 'filter', parameters: {
		image: { inputSource: 'node', nodeId: 'missing', outputPort: 'output', fitMode: 'cover', wrapMode: 'repeat', filterMode: 'linear' },
	} }), /Node output not found/);
	assert.deepEqual(f.visualModule, before);
});

// 【ノード削除でRelayへの接続も切断または主入力へ再接続する】
// エフェクト入力だけを修復するとRelayが削除済みのIDを指したまま残るため、
// インポートしたグラフでも接続を一緒に更新し、Undoで元の配線を復元する。
test('reconnects relay inputs on removal and restores the graph on undo', () => {
	for (const reconnection of ['disconnect', 'primaryInput']) {
		const f = fixture(true);
		const added = f.command().execute(f.state);
		f.visualModule.nodes.splice(2, 0, { id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: added.nodeId, outputPort: 'result' } });
		const before = structuredClone(f.visualModule);
		const remove = prepareTestCommand(f.definitions.removeVisualModuleNode, { target: added, reconnection });
		remove.execute(f.state);
		assert.deepEqual(f.visualModule.nodes.find(node => node.id === 'relay').input, reconnection === 'disconnect'
			? { nodeId: null, outputPort: null } : { nodeId: 'previous', outputPort: 'secondary' });
		remove.undo(f.state);
		assert.deepEqual(f.visualModule, before);
	}
});

// 【登録済み・インラインのVisual Moduleで中継ノードの追加と再配線を取り消せる】
// 追加だけで既存の配線を変えず、入力を差し替えても接続先の出力ポートやサンプリング設定を変えない。
test('adds, rewires, and disconnects relay nodes with undo and redo', () => {
	for (const inline of [false, true]) {
		const f = fixture(true, inline);
		const before = structuredClone(f.visualModule);
		const create = prepareTestCommand(f.definitions.createVisualModuleRelayNode, { visualModule: f.target });
		const target = create.execute(f.state);
		const node = () => f.visualModule.nodes.find(candidate => candidate.id === target.nodeId);
		const disconnected = { nodeId: null, outputPort: null };
		assert.deepEqual(node(), { id: target.nodeId, type: 'relay', dataType: { kind: 'any' }, input: disconnected });
		assert.equal(f.visualModule.nodes.at(-2).id, target.nodeId);
		assert.deepEqual(f.visualModule.nodes.at(-1).inputs, before.nodes.at(-1).inputs);
		const editInput = source => prepareTestCommand(f.definitions.setVisualModuleRelayInput, { target, source });
		const first = { nodeId: 'previous', outputPort: 'secondary' };
		const second = { nodeId: 'previous', outputPort: 'main' };
		const connect = editInput({ ...first, filterMode: 'nearest' });
		const rewire = editInput(second);
		const disconnect = editInput(null);
		connect.execute(f.state);
		assert.deepEqual(node().input, first);
		rewire.execute(f.state);
		assert.deepEqual(node().input, second);
		disconnect.execute(f.state);
		assert.deepEqual(node().input, disconnected);
		disconnect.undo(f.state);
		assert.deepEqual(node().input, second);
		rewire.undo(f.state);
		assert.deepEqual(node().input, first);
		connect.undo(f.state);
		create.undo(f.state);
		assert.deepEqual(f.visualModule, before);
		assert.deepEqual(create.execute(f.state), target);
		connect.execute(f.state);
		assert.deepEqual(node().input, first);
	}
});

// 【固定型の中継ノードでは型安全設定を尊重し、存在しないポートと自己接続を拒否する】
// インポートされた中継ノードには具体的な型があり、候補選択以外から渡された配線も検査する。
test('validates relay source ports and honors the connection type policy', () => {
	const f = fixture();
	const relay = { id: 'relay', type: 'relay', dataType: { kind: 'scalar' }, input: { nodeId: null, outputPort: null } };
	f.visualModule.nodes.splice(1, 0, relay);
	const target = { visualModule: f.target, nodeId: relay.id };
	const command = f.definitions.setVisualModuleRelayInput;
	const source = { nodeId: 'previous', outputPort: 'main' };
	assert.throws(() => command.prepare(f.state, { target, source }), /type does not match/);
	assert.throws(() => command.prepare(f.state, { target, source: { ...source, outputPort: 'missing' } }), /Node output not found/);
	assert.throws(() => command.prepare(f.state, { target, source: { nodeId: relay.id, outputPort: 'output' } }), /cannot connect to itself/);
	assert.deepEqual(relay.input, { nodeId: null, outputPort: null });
	command.prepare(f.state, { target, source, connectionTypePolicy: 'allowMismatch' }).change.apply(f.state);
	assert.deepEqual(relay.input, source);
});

// 【中継ノードの名前を消すと既定表示へ戻り、Undoで名前と未設定状態を復元できる】
// エフェクトと同じ表示名コマンドを通しても、中継ノードの保存値は任意項目のlabelに保つ。
test('renames and clears a relay label with undo and redo', () => {
	const f = fixture();
	const create = prepareTestCommand(f.definitions.createVisualModuleRelayNode, { visualModule: f.target });
	const target = create.execute(f.state);
	const relay = f.visualModule.nodes.find(node => node.id === target.nodeId);
	const rename = prepareTestCommand(f.definitions.setVisualModuleNodeDisplayName, { target, displayName: 'Shared mask' });
	const clear = prepareTestCommand(f.definitions.setVisualModuleNodeDisplayName, { target, displayName: '' });
	assert.equal(Object.hasOwn(relay, 'label'), false);
	rename.execute(f.state);
	assert.equal(relay.label, 'Shared mask');
	clear.execute(f.state);
	assert.equal(Object.hasOwn(relay, 'label'), false);
	clear.undo(f.state);
	assert.equal(relay.label, 'Shared mask');
	rename.undo(f.state);
	assert.equal(Object.hasOwn(relay, 'label'), false);
	rename.execute(f.state);
	assert.equal(relay.label, 'Shared mask');
});

// 【中継ノードの型変更は配線を保ち、型安全設定でも既存の接続元を表示する】
// 型を変えた直後に接続元を見失わないよう、既存の不一致を表示しつつ、新しい不一致候補は除外する。
test('changes the relay data type without hiding or rewriting existing connections', () => {
	const f = fixture();
	const target = prepareTestCommand(f.definitions.createVisualModuleRelayNode, { visualModule: f.target }).execute(f.state);
	const relay = f.visualModule.nodes.find(node => node.id === target.nodeId);
	const input = { nodeId: 'previous', outputPort: 'secondary' };
	const output = { nodeId: relay.id, outputPort: 'output' };
	prepareTestCommand(f.definitions.setVisualModuleRelayInput, { target, source: input }).execute(f.state);
	const out = f.visualModule.nodes.at(-1);
	out.inputs.primary = output;

	const changeType = prepareTestCommand(f.definitions.setVisualModuleRelayDataType, { target, dataType: { kind: 'scalar' } });
	changeType.execute(f.state);
	assert.deepEqual(relay.dataType, { kind: 'scalar' });
	assert.deepEqual(relay.input, input);
	assert.deepEqual(out.inputs.primary, output);
	assert.deepEqual(f.getNodeOutputItems(f.visualModule.nodes, relay.id, relay.dataType, [], undefined, input)
		.map(item => [item.connection.outputPort, item.typeCompatible]), [['secondary', false]]);
	const selectedOutput = f.getNodeOutputItems(f.visualModule.nodes, out.id, { kind: 'color' }, [], undefined, output)
		.find(item => item.connection.nodeId === relay.id);
	assert.equal(selectedOutput.typeCompatible, false);
	assert.equal(f.getNodeOutputItems(f.visualModule.nodes, out.id, { kind: 'color' }).some(item => item.connection.nodeId === relay.id), false);
	changeType.undo(f.state);
	assert.deepEqual(relay.dataType, { kind: 'any' });
	changeType.execute(f.state);
	assert.deepEqual(relay.dataType, { kind: 'scalar' });
	assert.deepEqual(out.inputs.primary, output);
});
