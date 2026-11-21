import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectCustomNodeGraphEffectResources } from '../src/custom-node-graph-effect-resources.ts';
import { createProjectEffectDefinitions } from '../src/project/effects.ts';

const colorOutput = { dataType: { kind: 'color' }, nameForReference: 'color' };
const definition = { kind: 'generate', paramDefs: {}, outputDefs: { color: colorOutput },
	primaryInputParameter: null, primaryOutput: 'color', resolutionInputParameters: [] };
const graph = (nodes, outputNode) => ({ ...definition, nodes, outputSources: { color: { nodeId: outputNode, outputPort: 'color' } } });
const node = (id, effectSource) => ({ id, effectSource, params: {} });
const shader = { ...definition, shaderApiVersion: 1, code: 'fn main(position: vec2f) -> Output { return Output(vec4f(1.)); }' };
const graphReference = { type: 'customNodeGraphEffectReference', id: 'shared-id' };
const shaderReference = { type: 'customShaderEffectReference', id: 'shared-id' };
const nativeReference = { type: 'nativeEffect', id: 'shared-id' };
const literal = value => ({ inputSource: 'literal', value });
const assetSetting = { dataType: { kind: 'assetReference', assetType: 'image' }, ui: { label: 'Image' }, defaultValue: 'shared-id' };
const audio = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, defaultValue: null };
const audioList = {
	dataType: { kind: 'array', elementType: { kind: 'struct', fields: { audio: audio.dataType } } },
	ui: { label: 'Tracks', control: { element: { fields: { audio: audio.ui } } } },
	defaultValue: [],
	element: { defaultValue: { audio: null }, fields: { audio: { defaultValue: null } } },
};
const nativeDefinitions = { 'shared-id': { ...definition, paramDefs: { tracks: audioList }, staticSettingDefs: { image: assetSetting } } };

function resources() {
	const audioNode = { ...node('native', nativeReference), params: {
		tracks: literal([{ id: 'track', binding: literal({ audio: literal({ type: 'player', playerId: 'shared-id' }) }) }]),
	} };
	const child = graph([audioNode, node('shader', shaderReference)], 'shader');
	const inner = graph([node('first', graphReference), node('second', graphReference)], 'second');
	const root = graph([
		node('inner', { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: inner }),
		node('inline-shader', { type: 'inlineCustomShaderEffect', customShaderEffect: shader }),
		node('shader', shaderReference),
	], 'inner');
	return {
		customNodeGraphEffect: root,
		nodeMetadata: { inner: { inlineCustomNodeGraphEffect: { nodeMetadata: { first: { position: { x: 3, y: 4 } } } } } },
		customNodeGraphEffects: [
			{ id: 'shared-id', name: 'Child', definition: child, nodeMetadata: { native: { displayName: 'Input' } } },
			{ id: 'unused', name: 'Unused', definition: graph([node('unused', { type: 'nativeEffect', id: 'missing' })], 'unused') },
		],
		customShaderEffects: [
			{ id: 'shared-id', name: 'Shader', summary: '', definition: { ...shader, staticSettingDefs: { image: assetSetting } } },
			{ id: 'unused', name: 'Unused', summary: '', definition: shader },
		],
		assets: ['shared-id', 'unused'].map(id => ({ id, name: id, width: 1, height: 1, fileDataType: 'image/png',
			fileData: { url: 'blob:image', size: 1, error: null }, originalFilePath: '/source' })),
		players: [{ id: 'shared-id', name: 'Player', sourceType: 'asset', assetId: 'shared-id', deviceId: 'private' }],
	};
}

// 【参照型とインライン型をまたいで必要な登録と素材だけを一度ずつ収集する】
// 入れ子で同じ登録を繰り返し使っても、所属プロジェクトの全定義や取り込み元の情報を配布物に含めない。
test('collects the transitive graph and asset dependencies into a detached snapshot', () => {
	const input = resources();
	const output = collectCustomNodeGraphEffectResources(input, nativeDefinitions);
	for (const entries of [output.customShaderEffects, output.customNodeGraphEffects, output.assets, output.players]) {
		assert.deepEqual(entries.map(entry => entry.id), ['shared-id']);
	}
	assert.deepEqual(output.customNodeGraphEffect, input.customNodeGraphEffect);
	assert.deepEqual(output.nodeMetadata, input.nodeMetadata);
	assert.notEqual(output.nodeMetadata.inner.inlineCustomNodeGraphEffect, input.nodeMetadata.inner.inlineCustomNodeGraphEffect);
	assert.deepEqual(output.customNodeGraphEffects[0].nodeMetadata, input.customNodeGraphEffects[0].nodeMetadata);
	assert.equal(Object.hasOwn(output.assets[0], 'originalFilePath'), false);
	assert.equal(Object.hasOwn(output.players[0], 'deviceId'), false);
	assert.notEqual(output.assets[0].fileData, input.assets[0].fileData);
	assert.notEqual(output.customNodeGraphEffect.nodes[1].effectSource.customShaderEffect, shader);
});

// 【種類ごとにIDを割り当てて、配置・既定値・Playerの素材参照を同時に再マップする】
// 同じ文字列をNative Effectやノード内部のIDにも使用できるため、単純な文字列置換では配線が壊れる。
test('remaps each resource once by kind while preserving native references and local wiring', () => {
	const input = resources();
	const original = structuredClone(input);
	const calls = [];
	const output = collectCustomNodeGraphEffectResources(input, nativeDefinitions, (kind, id) => {
		calls.push([kind, id]);
		return 'new-' + kind;
	});
	assert.deepEqual(calls.sort(), ['asset', 'customNodeGraphEffect', 'customShaderEffect', 'player'].map(kind => [kind, 'shared-id']));
	const inner = output.customNodeGraphEffect.nodes[0].effectSource.customNodeGraphEffect;
	assert.deepEqual(inner.nodes.map(node => node.effectSource.id), ['new-customNodeGraphEffect', 'new-customNodeGraphEffect']);
	assert.deepEqual(inner.outputSources.color, { nodeId: 'second', outputPort: 'color' });
	const child = output.customNodeGraphEffects[0];
	assert.equal(child.id, 'new-customNodeGraphEffect');
	assert.deepEqual(child.definition.nodes[0].effectSource, nativeReference);
	assert.equal(child.definition.nodes[0].staticSettings.image, 'new-asset');
	assert.equal(child.definition.nodes[0].params.tracks.value[0].binding.value.audio.value.playerId, 'new-player');
	assert.equal(output.players[0].assetId, output.assets[0].id);
	assert.equal(child.definition.nodes[1].effectSource.id, output.customShaderEffects[0].id);
	assert.equal(output.customNodeGraphEffect.nodes[2].effectSource.id, 'new-customShaderEffect');
	assert.equal(output.customShaderEffects[0].definition.staticSettingDefs.image.defaultValue, 'new-asset');
	assert.deepEqual(input, original);
	assert.deepEqual(collectCustomNodeGraphEffectResources(output, nativeDefinitions), output);
});

// 【入れ子の音声既定値だけから参照されるPlayerを同梱し、取り込み先のIDへ変換する】
// 配列の初期要素・追加時の要素・構造体フィールドの設定にはそれぞれ独立した既定値がある。
// どれか一箇所だけに参照がある場合でも、いずれのPlayerも配置先で解決できるようにする。
test('collects and remaps Players referenced only by nested parameter defaults', () => {
	const input = resources();
	const selection = playerId => ({ type: 'player', playerId });
	input.customNodeGraphEffects[0].definition.paramDefs = {
		tracks: {
			...audioList,
			defaultValue: [{ audio: selection('initial') }],
			element: { defaultValue: { audio: selection('added') }, fields: { audio: { defaultValue: selection('field') } } },
		},
	};
	for (const id of ['initial', 'added', 'field']) input.players.push({ id, name: id, sourceType: 'asset', assetId: 'shared-id' });
	const original = structuredClone(input);
	const output = collectCustomNodeGraphEffectResources(input, nativeDefinitions, (kind, id) => kind + '-' + id);
	const tracks = output.customNodeGraphEffects[0].definition.paramDefs.tracks;
	assert.deepEqual(tracks.defaultValue, [{ audio: selection('player-initial') }]);
	assert.deepEqual(tracks.element.defaultValue, { audio: selection('player-added') });
	assert.deepEqual(tracks.element.fields.audio.defaultValue, selection('player-field'));
	assert.deepEqual(output.players.map(player => player.id).sort(), ['player-added', 'player-field', 'player-initial', 'player-shared-id']);
	assert.deepEqual(input, original);
});

// 【設定による未選択とPlayer経由でのみ参照されるAssetを区別する】
// Native Effectの既定素材が配置側で明示的に解除されたときは、その素材を要求しない。
test('honors null overrides and includes assets reached only through a Player', () => {
	const input = resources();
	const playerSetting = { dataType: { kind: 'playerReference' }, ui: { label: 'Player' }, defaultValue: 'shared-id' };
	input.customNodeGraphEffect = graph([{ ...node('native', nativeReference), staticSettings: { image: null } }], 'native');
	const definitions = { 'shared-id': { ...definition, staticSettingDefs: {
		player: playerSetting, image: { ...assetSetting, defaultValue: 'missing' },
	} } };
	const output = collectCustomNodeGraphEffectResources(input, definitions);
	assert.deepEqual(output.customNodeGraphEffect.nodes[0].staticSettings, { image: null, player: 'shared-id' });
	assert.deepEqual(output.assets.map(asset => asset.id), ['shared-id']);
	input.assets = [];
	assert.throws(() => collectCustomNodeGraphEffectResources(input, definitions), /Missing Asset: shared-id/);
});

// 【インライン定義のポートIDを保持し、既定のPlayer参照を取り込み先へ向ける】
// ポートには任意の文字列IDを使用できる。配線とレコードのキーを対応させたまま、素材の参照だけを更新する。
test('preserves arbitrary inline port IDs and remaps defaults in embedded definitions', () => {
	const input = resources();
	const port = '__proto__';
	const playerSetting = { dataType: { kind: 'playerReference' }, ui: { label: 'Player' }, defaultValue: 'shared-id' };
	const inlineShader = { ...shader, outputDefs: { [port]: colorOutput }, primaryOutput: port, staticSettingDefs: { player: playerSetting } };
	input.customNodeGraphEffect = { ...definition, nodes: [node('inline', { type: 'inlineCustomShaderEffect', customShaderEffect: inlineShader })],
		outputSources: { color: { nodeId: 'inline', outputPort: port } } };
	const output = collectCustomNodeGraphEffectResources(input, {}, (kind, id) => kind + '-' + id);
	const embedded = output.customNodeGraphEffect.nodes[0].effectSource.customShaderEffect;
	assert.equal(Object.hasOwn(embedded.outputDefs, port), true);
	assert.equal(output.customNodeGraphEffect.outputSources.color.outputPort, port);
	assert.equal(embedded.staticSettingDefs.player.defaultValue, output.players[0].id);
	assert.equal(output.players[0].assetId, output.assets[0].id);
	assert.deepEqual(output.customShaderEffects, []);
});

// 【壊れた登録参照と循環参照を読み込み境界で報告する】
// 描画できない保存データを部分的に取り込まないよう、参照先と有向グラフを検証する。
test('reports missing and cyclic registrations before allocating destination IDs', () => {
	const input = resources();
	const assignId = () => assert.fail('unexpected ID allocation');
	input.customShaderEffects = [];
	assert.throws(() => collectCustomNodeGraphEffectResources(input, nativeDefinitions, assignId), /Unknown Custom Shader Effect/);
	input.customNodeGraphEffects[0].definition = graph([node('self', graphReference)], 'self');
	assert.throws(() => collectCustomNodeGraphEffectResources(input, nativeDefinitions, assignId), /Cyclic Custom Node Graph Effect/);
});

// 【同一IDのNative Effect・Custom Shader Effect・Custom Node Graph Effectを独立に解決する】
// 表示名やIDの衝突で別種の定義を引いてはならない。検証済みの登録から種類別に解決する。
test('resolves each effect kind in its own registry', () => {
	const input = resources();
	const definitions = createProjectEffectDefinitions(input, nativeDefinitions);
	assert.equal(definitions.getNativeEffect('shared-id'), nativeDefinitions['shared-id']);
	assert.equal(definitions.getCustomShaderEffect('shared-id'), input.customShaderEffects[0].definition);
	assert.equal(definitions.getCustomNodeGraphEffect('shared-id'), input.customNodeGraphEffects[0].definition);
});

// 【登録内の重複と未知のNative Effectは書き出し前に拒否する】
// ランタイムの索引では再検証しないため、IDを割り当てる前に静的な条件を確定する。
test('rejects duplicate registrations and missing native references before export', () => {
	const input = resources();
	const assignId = () => assert.fail('unexpected ID allocation');
	input.customShaderEffects.push(input.customShaderEffects[0]);
	assert.throws(() => collectCustomNodeGraphEffectResources(input, nativeDefinitions, assignId), /Duplicate Custom Shader Effect/);
	input.customShaderEffects.pop();
	input.customNodeGraphEffects.push(input.customNodeGraphEffects[0]);
	assert.throws(() => collectCustomNodeGraphEffectResources(input, nativeDefinitions, assignId), /Duplicate Custom Node Graph Effect/);
	input.customNodeGraphEffects.pop();
	for (const id of ['missing', 'constructor', '__proto__']) {
		input.customNodeGraphEffect = graph([node('missing', { type: 'nativeEffect', id })], 'missing');
		assert.throws(() => collectCustomNodeGraphEffectResources(input, nativeDefinitions, assignId), /Unknown Native Effect/);
	}
});
