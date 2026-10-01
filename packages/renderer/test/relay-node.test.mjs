import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

globalThis.GPUQueue = class { submit() {} };

const load = path => loadShaderSource(fileURLToPath(new URL(path, import.meta.url)));
const { VisualModuleRenderer } = await load('../src/visual-module-renderer.ts');
const { getNodeOutputs } = await load('../../shared/src/utility/node-outputs.ts');

const reference = (nodeId, outputPort = 'output') => ({ nodeId, outputPort });
const literal = value => ({ inputSource: 'literal', value });
const relay = (id, input = reference('in', 'input'), kind = 'color') => ({ id, type: 'relay', dataType: { kind }, input });
const connection = (nodeId, settings = {}) => ({ inputSource: 'node', ...reference(nodeId), fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear', ...settings });
const effectNode = (id, params = {}, isBypass = false) => ({ id, type: 'effect', resolution: { mode: 'project' }, effectId: 'probe', params, isBypass });
const context = (output = { kind: 'uniform', value: [0.25, 0, 0, 0.5] }) => ({
	time: 0, timeDelta: 0, endTime: Infinity, isExport: false,
	pointerPosition: { x: 0, y: 0 }, pointerPositionPrev: { x: 0, y: 0 },
	evaluatedParamValues: new Map(), paramInputs: new Map([['input', output]]),
});

function fixture(t, nodes, { kind = 'color', paramDefs = {}, lazy = false, disableCache = false } = {}) {
	const calls = { textures: [], renders: [], prepares: [], disposed: 0 };
	const definition = {
		paramDefs, primaryInputParameter: Object.keys(paramDefs)[0] ?? null, primaryOutput: 'output',
		outputDefs: Object.fromEntries(['output', 'extra'].map(port => [port, { dataType: { kind }, canLazyAllocation: lazy }])),
	};
	const implementation = {
		disableCache,
		outputTextureFactories: Object.fromEntries(['output', 'extra'].map(port => [port, () => {
			const texture = { port, width: 16, height: 16, destroyed: 0, createView() { return { texture }; }, destroy() { this.destroyed++; } };
			calls.textures.push(texture);
			return texture;
		}])),
		init: () => ({
			prepare(params) { calls.prepares.push(params); },
			render(args) { calls.renders.push(args); },
			dispose() { calls.disposed++; },
		}),
	};
	const module = {
		id: 'module', name: 'module', automationGraphs: [],
		paramDefs: [{ id: 'input', nameForReference: 'Input', dataType: { kind }, canNode: true }],
		primaryInputId: 'input',
		outputDefs: [{ id: 'out', dataType: { kind } }], primaryOutputId: 'out',
		nodes: [{ id: 'in', type: 'globalIn' }, ...nodes, { id: 'out', type: 'globalOut', inputs: { out: reference(nodes.at(-1).id) } }],
	};
	const renderer = new VisualModuleRenderer({
		gpuDevice: { limits: { maxTextureDimension2D: 8192 }, createShaderModule: () => ({}) }, gpuContext: {}, fallbackTexture: {}, timingHelper: null,
		resolution: { width: 16, height: 16 }, enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm',
		videoFrames: new Map(), videoFrameVersions: new Map(), assets: [], assetTextures: new Map(), audioSources: new Map(),
		effectDefinitions: { probe: definition }, effectImplementations: { probe: implementation }, visualModule: module,
	});
	t.after(() => renderer.destroy());
	return { renderer, module, calls, render: (ctx = context()) => renderer.render(ctx, {}) };
}

const colorInput = { dataType: { kind: 'color' }, canNode: true };

// 未接続でも固定型の出力ポートを公開する
// 上流を交換する途中でも後段の接続契約を維持し、ポートが消えることを防ぐ。
test('declares a fixed output type even when disconnected', () => {
	const node = relay('relay', { nodeId: null, outputPort: null }, 'vector');
	assert.deepEqual(getNodeOutputs(node), { output: { dataType: { kind: 'vector' } } });
});

for (const [kind, value] of [['scalar', [0.123456789]], ['vector', [-2, 3]], ['color', [0.25, 0, 0, 0.5]]]) {
	// 中継を連ねても定数の精度・成分・乗算済みアルファを維持する
	// 中継の追加でテクスチャ化や色の再乗算が起きると、画質と性能が配線の整理だけで変わってしまう。
	test(`preserves ${kind} uniforms through relay chains without GPU allocation`, async t => {
		const f = fixture(t, [relay('first', undefined, kind), relay('second', reference('first'), kind)], { kind });
		const output = { kind: 'uniform', value };
		const ctx = context(output);
		await f.renderer.prepare(ctx, new AbortController().signal);
		assert.equal(f.render(ctx), output);
		assert.equal(f.calls.textures.length, 0);
		assert.equal(f.calls.renders.length, 0);
	});
}

// 借用テクスチャの形式と所有権を変えない
// relayは画像処理もリソース所有も行わず、破棄時に入力元のテクスチャを壊してはいけない。
test('passes borrowed textures through unchanged without destroying them', t => {
	const f = fixture(t, [relay('relay')]);
	let destroyed = false;
	const output = { kind: 'texture', texture: { destroy() { destroyed = true; } } };
	assert.equal(f.render(context(output)), output);
	f.renderer.destroy();
	assert.equal(destroyed, false);
	assert.equal(f.calls.textures.length, 0);
});

// 分岐先ごとのサンプリング設定を維持し、同一フレームで上流を一度だけ描画する
// 中継点でサンプリングすると接続先ごとの見た目が変わり、重複描画すると履歴系エフェクトの時間が余分に進む。
test('preserves consumer sampling and renders a shared upstream effect once', async t => {
	const settings = { fitMode: 'contain', wrapMode: 'clampToEdge', filterMode: 'nearest' };
	const f = fixture(t, [effectNode('source', { a: literal([1, 0, 0, 1]), b: literal([0, 0, 0, 0]) }), relay('relay', reference('source', 'extra')), effectNode('consumer', {
		a: connection('relay', settings), b: connection('relay'),
	})], { paramDefs: { a: colorInput, b: colorInput }, disableCache: true });
	const ctx = context();
	await f.renderer.prepare(ctx, new AbortController().signal);
	f.render(ctx);
	assert.equal(f.calls.prepares.length, 2);
	assert.equal(f.calls.renders.length, 2);
	const params = f.calls.renders.at(-1).params;
	assert.equal(params.a.texture, f.calls.renders[0].outputDataMap.extra.texture);
	assert.equal(params.a.texture, params.b.texture);
	assert.equal(params.a.fitMode, settings.fitMode);
	assert.equal(params.a.wrapMode, settings.wrapMode);
	assert.equal(params.a.filterMode, settings.filterMode);
	assert.equal(params.b.filterMode, 'linear');
});

// 中継経由でも必要な出力だけ遅延確保し、上流のポート交換を反映する
// relayを通常の出力として数えると実際の生成元の出力が確保されず、交換後に古い画像が残ってしまう。
test('tracks lazy output usage through relay chains and upstream port changes', t => {
	const node = relay('relay', reference('source', 'extra'));
	const f = fixture(t, [effectNode('source'), node], { lazy: true });
	const first = f.render();
	assert.equal(first.texture.port, 'extra');
	assert.equal(f.calls.textures.length, 1);
	node.input = reference('source');
	f.renderer.updateNodes(f.module.nodes);
	assert.equal(f.render().texture.port, 'output');
	assert.equal(first.texture.destroyed, 1);
	assert.equal(f.calls.renders.length, 2);
});

// 上流の値の変化と接続先交換を後段のキャッシュへ伝える
// 中継自身に描画処理がなくても、依存を無視すると後段が古い結果を使い続ける。
test('invalidates downstream caches for uniform changes and relay rewiring', t => {
	const node = relay('relay');
	const f = fixture(t, [
		effectNode('source', { input: literal([1, 0, 0, 1]) }),
		effectNode('replacement', { input: literal([1, 0, 0, 1]) }),
		node, effectNode('consumer', { input: connection('relay') }),
	], { paramDefs: { input: colorInput } });
	f.render();
	f.render();
	assert.equal(f.calls.renders.length, 1);
	f.render(context({ kind: 'uniform', value: [0, 0.5, 0, 0.5] }));
	assert.equal(f.calls.renders.length, 2);
	node.input = reference('source');
	f.renderer.updateNodes(f.module.nodes);
	f.render();
	assert.equal(f.calls.renders.length, 4);
	assert.equal(f.calls.renders.at(-1).params.input.texture, f.calls.renders.at(-2).outputDataMap.output.texture);
	const previousTexture = f.calls.renders.at(-1).params.input.texture;
	// パラメータが同一でも生成元が違えば別のテクスチャなので、後段のbindingを更新する。
	node.input = reference('replacement');
	f.renderer.updateNodes(f.module.nodes);
	f.render();
	assert.equal(f.calls.renders.length, 6);
	assert.notEqual(f.calls.renders.at(-1).params.input.texture, previousTexture);
	// 接続解除でも再評価し、以前の入力を残さず後段の空の入力へ戻す。
	node.input = { nodeId: null, outputPort: null };
	f.renderer.updateNodes(f.module.nodes);
	f.render();
	assert.equal(f.calls.renders.length, 7);
	assert.deepEqual(f.calls.renders.at(-1).params.input, { kind: 'uniform', value: [0, 0, 0, 0] });
});

// 同じ借用テクスチャでも毎フレーム更新を後段へ伝える
// 動画などはテクスチャの同一性を保ったまま内容が変わるため、relayでキャッシュを固定すると映像が止まる。
test('keeps consumers live when a borrowed texture retains its identity', t => {
	const f = fixture(t, [relay('relay'), effectNode('consumer', { input: connection('relay') })], { paramDefs: { input: colorInput } });
	const output = { kind: 'texture', texture: {} };
	f.render(context(output));
	f.render(context(output));
	assert.equal(f.calls.renders.length, 2);
});

// バイパスと中継を混在させても定数をそのまま通す
// エフェクトの有効・無効の切り替えで、中継を含む接続の意味が変わってはいけない。
test('resolves relays on both sides of a bypassed effect', t => {
	const f = fixture(t, [relay('first'), effectNode('bypass', { input: connection('first') }, true), relay('last', reference('bypass'))], { paramDefs: { input: colorInput } });
	const output = { kind: 'uniform', value: [0.25, 0, 0, 0.5] };
	assert.equal(f.render(context(output)), output);
	assert.equal(f.calls.renders.length, 0);
});

for (const input of [{ nodeId: null, outputPort: null }, reference('missing'), reference('in', 'missing')]) {
	// 未接続・欠落した参照は出力なしとして扱う
	// 前段の削除や交換の途中に古い出力を公開せず、Outノードの未接続と同じように扱う。
	test(`returns no output for unavailable relay input ${JSON.stringify(input)}`, async t => {
		const f = fixture(t, [relay('relay', input)]);
		await f.renderer.prepare(context(), new AbortController().signal);
		assert.equal(f.render(), undefined);
	});
}

// 存在しない中継出力名を暗黙に主出力へ置き換えない
// 誤ったポート参照を成功扱いにすると、保存データの接続ミスが別の画像として表示されてしまう。
test('does not resolve an unknown relay output port', t => {
	const f = fixture(t, [relay('relay')]);
	f.module.nodes.at(-1).inputs.out.outputPort = 'missing';
	assert.equal(f.render(), undefined);
});

for (const output of [{ kind: 'uniform', value: [0.25, 0, 0, 0.5] }, { kind: 'texture', texture: {} }]) {
	// 宣言型が異なっても定数・テクスチャを変換せず通す
	// Glitch Studioでは意図的な異種型接続を許容する。中継を挟んだだけで描画が失敗したり、
	// 成分数やアルファが変わったりしないよう、準備と描画の両方で型の強制がないことを確認する。
	test(`passes ${output.kind} outputs through mismatched relay declarations in prepare and render`, async t => {
		const f = fixture(t, [relay('first', undefined, 'scalar'), relay('second', reference('first'), 'vector')]);
		const ctx = context(output);
		await f.renderer.prepare(ctx, new AbortController().signal);
		assert.equal(f.render(ctx), output);
		assert.equal(f.calls.textures.length, 0);
	});
}

// anyの接続互換性は既存のノード接続規約に従う
// 固定型の導入を理由にanyだけを拒否したり、通過するデータへ暗黙の変換を加えたりしない。
test('honors any compatibility without converting the output', t => {
	const f = fixture(t, [relay('first', undefined, 'any'), relay('second', reference('first'), 'color')], { kind: 'scalar' });
	const output = { kind: 'uniform', value: [0.125] };
	assert.equal(f.render(context(output)), output);
});

for (const nodes of [
	[relay('relay', reference('relay'))],
	[relay('first', reference('second')), relay('second', reference('first'))],
	[relay('relay', reference('effect')), effectNode('effect', { input: connection('relay') })],
]) {
	// 自己参照・中継同士・エフェクトを含む循環を検出する
	// 配線の整理中にも循環は発生し得るため、準備や描画が無限再帰して停止する前に報告する。
	test(`rejects cycles through ${nodes.map(node => node.id).join(' and ')}`, async t => {
		const f = fixture(t, nodes, { paramDefs: { input: colorInput } });
		await assert.rejects(f.renderer.prepare(context(), new AbortController().signal), /circular dependency/);
		assert.throws(() => f.render(), /circular dependency/);
	});
}
