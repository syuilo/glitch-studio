import { testGraph } from './helpers/effect-graph.mjs';
import { prepareTestCommand } from './helpers/prepared-command.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	stdin: {
		contents: "export { COMMAND_DEFS } from './commands.ts'; export { getCustomNodeGraphEffect } from './utility/custom-node-graph-effect-target.ts'; export { getNodeOutputItems } from './utility/node-outputs.ts'; export { commitCustomNodeGraphEffectEdit } from './utility/custom-node-graph-effect-edit.ts';",
		resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'auto-connect-dependencies', setup(build) {
		build.onResolve({ filter: /preferences\.ts$|(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, ({ path }) => ({ path, external: true }));
	} }],
});

function fixture(enabled = false, inline = false) {
	const preferences = { s: { customNodeGraphEffectAutoConnectOnNodeAdd: enabled, forceTypeSafety: true } };
	const disconnected = { inputSource: 'literal', value: [0, 0, 0, 0] };
	const effectDefinitions = {
		previous: { paramDefs: {}, outputDefs: { main: { dataType: { kind: 'color' } }, secondary: { dataType: { kind: 'color' } } } },
		filter: { primaryInputParameter: 'image', primaryOutput: 'result',
			paramDefs: { image: { canNode: true, dataType: { kind: 'color' }, defaultValue: disconnected } },
			outputDefs: { result: { dataType: { kind: 'color' } } } },
		scalar: { primaryInputParameter: 'value', primaryOutput: 'result',
			paramDefs: { value: { canNode: true, dataType: { kind: 'scalar' }, defaultValue: { inputSource: 'literal', value: 0 } } },
			outputDefs: { result: { dataType: { kind: 'scalar' } } } },
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(path => /preferences\.ts$/.test(path)
		? { preferences } : /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/.test(path) ? { nativeEffectDefinitions: effectDefinitions } : require(path), module, module.exports);
	const customNodeGraphEffect = testGraph({ primaryOutput: 'primary', outputDefs: {
		primary: { dataType: { kind: 'color' } }, other: { dataType: { kind: 'color' } },
	}, outputSources: { primary: { nodeId: 'previous', outputPort: 'secondary' }, other: { nodeId: 'previous', outputPort: 'main' } },
	nodes: [{ id: 'previous', type: 'effect', effectSource: { type: 'nativeEffect', id: 'previous' }, params: {} }] });
	const owner = inline ? { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect } : { id: 'custom-node-graph-effect', definition: customNodeGraphEffect };
	const state = { customNodeGraphEffects: { value: inline ? [] : [owner] },
		timelineScenes: { value: [{ id: 'scene', layers: inline ? [{ id: 'inline', layerType: 'effect', effectSource: owner }] : [] }] } };
	const target = inline ? { sceneId: 'scene', layerId: 'inline' } : { customNodeGraphEffectId: 'custom-node-graph-effect' };
	const command = (payload = {}) => prepareTestCommand(module.exports.COMMAND_DEFS.createCustomNodeGraphEffectEffectNode, { customNodeGraphEffect: target, effectSource: { type: 'nativeEffect', id: 'filter' }, connectionMode: enabled ? 'appendToPrimaryOutput' : 'none', ...payload });
	return { view: () => module.exports.getCustomNodeGraphEffect(state, target), owner, preferences, customNodeGraphEffect, state, command, disconnected, target, definitions: module.exports.COMMAND_DEFS, getNodeOutputItems: module.exports.getNodeOutputItems, commitEdit: module.exports.commitCustomNodeGraphEffectEdit };
}

// 【自動接続を無効にした追加では既存の配線と入力の既定値を維持する】
// 従来の追加操作を既定の挙動として保ち、後から設定を有効にしてもRedoで接続が増えないようにする。
test('preserves wiring when disabled even after enabling before redo', () => {
	const f = fixture();
	const before = structuredClone(f.customNodeGraphEffect);
	const command = f.command();
	const added = command.execute(f.state);
	assert.deepEqual(f.customNodeGraphEffect.nodes[1].params.image, f.disconnected);
	assert.deepEqual(f.customNodeGraphEffect.outputSources, before.outputSources);
	const after = structuredClone(f.customNodeGraphEffect);
	command.undo(f.state);
	assert.deepEqual(f.customNodeGraphEffect, before);
	f.preferences.s.customNodeGraphEffectAutoConnectOnNodeAdd = true;
	assert.equal(command.execute(f.state).nodeId, added.nodeId);
	assert.deepEqual(f.customNodeGraphEffect, after);
});

// 【登録済み・インラインの主出力を追加ノードへ繋ぎ、副出力の接続元も維持する】
// 主出力以外の配線を変えず、Undoで元へ戻す。設定を無効にしてもRedoは追加時の接続を復元する。
test('connects primary ports and preserves secondary source ports through undo and redo', () => {
	for (const inline of [false, true]) {
		const f = fixture(true, inline);
		const before = structuredClone(f.customNodeGraphEffect);
		const command = f.command();
		const added = command.execute(f.state);
		assert.deepEqual(f.customNodeGraphEffect.nodes.map(node => node.id), ['previous', added.nodeId]);
		assert.deepEqual(f.customNodeGraphEffect.nodes[1].params.image, { inputSource: 'node', source: { nodeId: 'previous', outputPort: 'secondary' },
			sampling: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } });
		assert.deepEqual(f.customNodeGraphEffect.outputSources.primary, { nodeId: added.nodeId, outputPort: 'result' });
		assert.deepEqual(f.customNodeGraphEffect.outputSources.other, before.outputSources.other);
		const after = structuredClone(f.customNodeGraphEffect);
		command.undo(f.state);
		assert.deepEqual(f.customNodeGraphEffect, before);
		f.preferences.s.customNodeGraphEffectAutoConnectOnNodeAdd = false;
		assert.equal(command.execute(f.state).nodeId, added.nodeId);
		assert.deepEqual(f.customNodeGraphEffect, after);
	}
});

// 【未接続・主出力なしでも追加でき、Undoで接続の未設定と明示的な解除を復元する】
// 初めて出力へ接続する場合や主出力を使わないCustom Node Graph Effectでも、追加前の状態を失わないようにする。
test('handles missing and disconnected primary outputs without losing their original state', () => {
	for (const mode of ['missing', 'noPrimary']) {
		const f = fixture(true);
		if (mode === 'missing') delete f.customNodeGraphEffect.outputSources.primary;

		if (mode === 'noPrimary') f.customNodeGraphEffect.primaryOutput = null;

		const before = structuredClone(f.customNodeGraphEffect);
		const command = f.command();
		const added = command.execute(f.state);
		assert.deepEqual(f.customNodeGraphEffect.nodes.find(node => node.id === added.nodeId).params.image, f.disconnected);
		if (mode === 'missing') {
			assert.deepEqual(f.customNodeGraphEffect.outputSources.primary, { nodeId: added.nodeId, outputPort: 'result' });
		}
		command.undo(f.state);
		assert.deepEqual(f.customNodeGraphEffect, before);
	}
});

// 【型安全設定と明示的な入力値を尊重する】
// 自動接続で接続不能な入力・出力や、呼び出し側が指定した入力値を上書きしないようにする。
test('respects incompatible data types and explicitly supplied parameters', () => {
	const f = fixture(true);
	const inputs = structuredClone(f.customNodeGraphEffect.outputSources);
	f.command({ effectSource: { type: 'nativeEffect', id: 'scalar' } }).execute(f.state);
	assert.deepEqual(f.customNodeGraphEffect.nodes[1].params.value, { inputSource: 'literal', value: 0 });
	assert.deepEqual(f.customNodeGraphEffect.outputSources, inputs);
	const explicit = fixture(true);
	explicit.command({ parameters: { image: explicit.disconnected } }).execute(explicit.state);
	assert.deepEqual(explicit.customNodeGraphEffect.nodes[1].params.image, explicit.disconnected);
});

// 【型が異なる接続は警告付きで作成し、設定を有効にすると新規接続を拒否する】
// 追加時の自動接続、ノード入力の再接続と公開出力の選択が同じ方針に従う。
// 既存の不一致を選択欄から消すと接続先の確認や解除ができなくなる。
test('allows mismatched connections with warnings and blocks new mismatches in strict mode', () => {
	const f = fixture(true);
	f.preferences.s.forceTypeSafety = false;
	const added = f.command({ effectSource: { type: 'nativeEffect', id: 'scalar' }, connectionTypePolicy: 'allowMismatch' }).execute(f.state);
	const graph = f.customNodeGraphEffect;
	const node = () => graph.nodes.find(node => node.id === added.nodeId);
	assert.deepEqual(node().params.value.source, { nodeId: 'previous', outputPort: 'secondary' });
	assert.deepEqual(graph.outputSources.primary, { nodeId: added.nodeId, outputPort: 'result' });
	const sampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
	const manager = { state: f.state, commit(name, input) { return prepareTestCommand(f.definitions[name], input).execute(f.state); } };
	const edit = outputPort => f.commitEdit(manager, f.target, { kind: 'editNodeParam', nodeId: added.nodeId,
		edit: { kind: 'node', paramPath: ['value'], value: { nodeId: 'previous', outputPort, ...sampling } } });
	edit('main');
	assert.equal(node().params.value.source.outputPort, 'main');
	const choices = () => f.getNodeOutputItems(f.view().nodes, added.nodeId, { kind: 'scalar' }, [], undefined, { nodeId: 'previous', outputPort: 'main' });
	assert.deepEqual(choices().map(item => [item.connection.outputPort, item.typeCompatible, item.icon]),
		[['main', false, 'ti ti-alert-triangle'], ['secondary', false, 'ti ti-alert-triangle']]);
	f.preferences.s.forceTypeSafety = true;
	assert.throws(() => edit('secondary'), /Node output type does not match/);
	assert.equal(node().params.value.source.outputPort, 'main');
	assert.deepEqual(choices().map(item => item.connection.outputPort), ['main']);
	const connectOutput = () => f.commitEdit(manager, f.target, { kind: 'setOutputConnection', outputId: 'other',
		value: { nodeId: added.nodeId, outputPort: 'result' } });
	assert.throws(connectOutput, /Node output type does not match/);
	f.preferences.s.forceTypeSafety = false;
	connectOutput();
	assert.equal(graph.outputSources.other.nodeId, added.nodeId);
});

// 【Commandは環境設定を参照せず、明示した接続方針だけを適用する】
// スクリプトが同じ入力から同じプロジェクト編集を行えるよう、UI設定を有効にしても
// 未指定の生成では配線しない。検証が失敗してもノードや出力を途中まで変更しない。
test('uses explicit connection policy and validates creation before mutating the graph', () => {
	const f = fixture(true);
	const before = structuredClone(f.customNodeGraphEffect);
	const prepared = f.definitions.createCustomNodeGraphEffectEffectNode.prepare(f.state, { customNodeGraphEffect: f.target, effectSource: { type: 'nativeEffect', id: 'filter' } });
	assert.deepEqual(f.customNodeGraphEffect, before);
	prepared.change.apply(f.state);
	assert.deepEqual(f.customNodeGraphEffect.nodes[1].params.image, f.disconnected);
	assert.deepEqual(f.customNodeGraphEffect.outputSources, before.outputSources);
	prepared.change.revert(f.state);
	assert.deepEqual(f.customNodeGraphEffect, before);
	assert.throws(() => f.definitions.createCustomNodeGraphEffectEffectNode.prepare(f.state, { customNodeGraphEffect: f.target, effectSource: { type: 'nativeEffect', id: 'filter' }, parameters: {
		image: { inputSource: 'node', nodeId: 'missing', outputPort: 'output', fitMode: 'cover', wrapMode: 'repeat', filterMode: 'linear' },
	} }), /Node output not found/);
	assert.deepEqual(f.customNodeGraphEffect, before);
});

// 【ノード削除でRelayへの接続も切断または主入力へ再接続する】
// エフェクト入力だけを修復するとRelayが削除済みのIDを指したまま残るため、
// インポートしたグラフでも接続を一緒に更新し、Undoで元の配線を復元する。
test('reconnects relay inputs on removal and restores the graph on undo', () => {
	for (const reconnection of ['disconnect', 'primaryInput']) {
		const f = fixture(true);
		const added = f.command().execute(f.state);
		f.customNodeGraphEffect.nodes.splice(2, 0, { id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: added.nodeId, outputPort: 'result' } });
		const before = structuredClone(f.customNodeGraphEffect);
		const remove = prepareTestCommand(f.definitions.removeCustomNodeGraphEffectNode, { target: added, reconnection });
		remove.execute(f.state);
		assert.deepEqual(f.customNodeGraphEffect.nodes.find(node => node.id === 'relay').input, reconnection === 'disconnect'
			? null : { nodeId: 'previous', outputPort: 'secondary' });
		remove.undo(f.state);
		assert.deepEqual(f.customNodeGraphEffect, before);
	}
});

// 【登録済み・インラインのCustom Node Graph Effectで中継ノードの追加と再配線を取り消せる】
// 追加だけで既存の配線を変えず、入力を差し替えても接続先の出力ポートやサンプリング設定を変えない。
test('adds, rewires, and disconnects relay nodes with undo and redo', () => {
	for (const inline of [false, true]) {
		const f = fixture(true, inline);
		const before = structuredClone(f.customNodeGraphEffect);
		const create = prepareTestCommand(f.definitions.createCustomNodeGraphEffectRelayNode, { customNodeGraphEffect: f.target });
		const target = create.execute(f.state);
		const node = () => f.customNodeGraphEffect.nodes.find(candidate => candidate.id === target.nodeId);
		const disconnected = null;
		assert.deepEqual(node(), { id: target.nodeId, type: 'relay', dataType: { kind: 'any' }, input: disconnected });
		assert.equal(f.customNodeGraphEffect.nodes.at(-1).id, target.nodeId);
		assert.deepEqual(f.customNodeGraphEffect.outputSources, before.outputSources);
		const editInput = source => prepareTestCommand(f.definitions.setCustomNodeGraphEffectRelayInput, { target, source });
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
		assert.deepEqual(f.customNodeGraphEffect, before);
		assert.deepEqual(create.execute(f.state), target);
		connect.execute(f.state);
		assert.deepEqual(node().input, first);
	}
});

// 【中継ノードは異なる型・存在しないポート・自己接続を拒否する】
// インポートされた中継ノードには具体的な型があり、候補選択以外から渡された配線も検査する。
test('validates relay source ports and rejects incompatible connections', () => {
	const f = fixture();
	const relay = { id: 'relay', type: 'relay', dataType: { kind: 'scalar' }, input: null };
	f.customNodeGraphEffect.nodes.splice(1, 0, relay);
	const target = { customNodeGraphEffect: f.target, nodeId: relay.id };
	const command = f.definitions.setCustomNodeGraphEffectRelayInput;
	const source = { nodeId: 'previous', outputPort: 'main' };
	assert.throws(() => command.prepare(f.state, { target, source }), /type does not match/);
	assert.throws(() => command.prepare(f.state, { target, source: { ...source, outputPort: 'missing' } }), /Node output not found/);
	assert.throws(() => command.prepare(f.state, { target, source: { nodeId: relay.id, outputPort: 'output' } }), /cannot connect to itself/);
	assert.equal(relay.input, null);
	const connect = prepareTestCommand(command, { target, source, connectionTypePolicy: 'allowMismatch' });
	connect.execute(f.state);
	assert.deepEqual(f.customNodeGraphEffect.nodes.find(node => node.id === target.nodeId).input, source);
});

// 【中継ノードの名前を消すと既定表示へ戻り、Undoで名前と未設定状態を復元できる】
// エフェクトと同じ表示名コマンドを通しても、中継ノードの保存値は任意項目のlabelに保つ。
test('renames and clears a relay label with undo and redo', () => {
	const f = fixture();
	const create = prepareTestCommand(f.definitions.createCustomNodeGraphEffectRelayNode, { customNodeGraphEffect: f.target });
	const target = create.execute(f.state);
	const relay = f.customNodeGraphEffect.nodes.find(node => node.id === target.nodeId);
	const rename = prepareTestCommand(f.definitions.setCustomNodeGraphEffectNodeDisplayName, { target, displayName: 'Shared mask' });
	const clear = prepareTestCommand(f.definitions.setCustomNodeGraphEffectNodeDisplayName, { target, displayName: '' });
	assert.equal(f.owner.nodeMetadata?.[relay.id]?.displayName, undefined);
	rename.execute(f.state);
	assert.equal(f.owner.nodeMetadata[relay.id].displayName, 'Shared mask');
	clear.execute(f.state);
	assert.equal(f.owner.nodeMetadata?.[relay.id]?.displayName, undefined);
	clear.undo(f.state);
	assert.equal(f.owner.nodeMetadata[relay.id].displayName, 'Shared mask');
	rename.undo(f.state);
	assert.equal(f.owner.nodeMetadata?.[relay.id]?.displayName, undefined);
	rename.execute(f.state);
	assert.equal(f.owner.nodeMetadata[relay.id].displayName, 'Shared mask');
});

// 【中継ノードの型変更は配線を保ち、型安全設定でも既存の接続元を表示する】
// 型を変えた直後に接続元を見失わないよう、既存の不一致を表示しつつ、新しい不一致候補は除外する。
test('changes the relay data type without hiding or rewriting existing connections', () => {
	const f = fixture();
	const target = prepareTestCommand(f.definitions.createCustomNodeGraphEffectRelayNode, { customNodeGraphEffect: f.target }).execute(f.state);
	const relay = () => f.customNodeGraphEffect.nodes.find(node => node.id === target.nodeId);
	const input = { nodeId: 'previous', outputPort: 'secondary' };
	const output = { nodeId: relay().id, outputPort: 'output' };
	prepareTestCommand(f.definitions.setCustomNodeGraphEffectRelayInput, { target, source: input }).execute(f.state);
	f.customNodeGraphEffect.outputSources.primary = output;

	const changeType = prepareTestCommand(f.definitions.setCustomNodeGraphEffectRelayDataType, { target, dataType: { kind: 'scalar' } });
	changeType.execute(f.state);
	assert.deepEqual(relay().dataType, { kind: 'scalar' });
	assert.deepEqual(relay().input, input);
	assert.deepEqual(f.customNodeGraphEffect.outputSources.primary, output);
	assert.deepEqual(f.getNodeOutputItems(f.view().nodes, relay().id, relay().dataType, [], undefined, input)
		.map(item => [item.connection.outputPort, item.typeCompatible]), [['secondary', false]]);
	const selectedOutput = f.getNodeOutputItems(f.view().nodes, 'globalOut', { kind: 'color' }, [], undefined, output)
		.find(item => item.connection.nodeId === relay().id);
	assert.equal(selectedOutput.typeCompatible, false);
	assert.equal(f.getNodeOutputItems(f.view().nodes, 'globalOut', { kind: 'color' }).some(item => item.connection.nodeId === relay().id), false);
	changeType.undo(f.state);
	assert.deepEqual(relay().dataType, { kind: 'any' });
	changeType.execute(f.state);
	assert.deepEqual(relay().dataType, { kind: 'scalar' });
	assert.deepEqual(f.customNodeGraphEffect.outputSources.primary, output);
});
