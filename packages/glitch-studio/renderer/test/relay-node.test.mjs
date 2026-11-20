import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';

const reference = (nodeId, outputPort = 'output') => ({ nodeId, outputPort });
const publicInput = { parameterId: 'input' };
const relay = (id, input = publicInput, kind = 'color') => ({ id, type: 'relay', dataType: { kind }, input });
const sampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
const connection = (nodeId, outputPort = 'output', options = sampling) => ({ inputSource: 'node', source: reference(nodeId, outputPort), sampling: options });
const node = (id, params = {}, isBypass = false) => ({ id, effectSource: { type: 'nativeEffect', id: 'probe' }, params, isBypass });
const parameter = kind => ({ dataType: { kind }, ui: { label: 'Input', control: {} }, canNode: true,
	defaultValue: { inputSource: 'literal', value: kind === 'color' ? [0, 0, 0, 0] : kind === 'vector' ? [0, 0] : 0 } });
const size = { width: 16, height: 16 };
const ports = { output: { dataType: { kind: 'color' } }, extra: { dataType: { kind: 'color' } } };
function setup(nodes, output = reference(nodes.at(-1).id), kind = 'color') {
	const graph = { nodes, paramDefs: { input: parameter(kind) }, outputDefs: { result: { dataType: { kind } } },
		outputSources: { result: output }, primaryInputParameter: 'input', primaryOutput: 'result', resolutionInputParameters: [] };
	const source = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph };
	const definition = { paramDefs: { a: parameter('color'), b: parameter('color') }, primaryInputParameter: 'a', primaryOutput: 'output',
		outputDefs: ports, resolutionInputParameters: [] };
	const definitions = { getNativeEffect: () => definition };
	const textures = [], renders = [], preparations = [];
	async function place(input) {
		return createEffectInstance({ effectSource: source, definitions, resolution: size, usedOutputPorts: new Set(['result']), inputs: { input } }, {}, () => ({
			createOutputTexture(port) {
				const texture = { ...size, port, destroyed: 0, destroy() { this.destroyed++; } };
				textures.push(texture); return texture;
			},
			init({ inputs, outputTextures }) { return { cacheKey: 0, prepare() { preparations.push(inputs); },
				render() { renders.push({ inputs, outputTextures }); }, dispose() {} }; },
		}));
	}
	return { graph, validate: () => validateEffectSource(source, definitions), place, textures, renders, preparations };
}
const frame = () => ({ time: 0, timeDelta: 0 });
const color = { kind: 'uniform', value: [0.25, 0, 0, 0.5] };

// 【未接続の中継でも宣言型を検証できる】
// まだGPU出力を持たない編集中の配線が有効か、宣言だけで判断する。
test('declares a fixed output type even when disconnected', async t => {
	const f = setup([relay('split', null, 'vector')], reference('split'), 'vector');
	f.validate();
	const instance = await f.place({ kind: 'uniform', value: [0, 0] }); t.after(() => instance.dispose());
	assert.equal(instance.outputs.has('result'), false);
});

for (const [kind, value] of [['scalar', [0.125]], ['vector', [-2, 3]], ['color', color.value]]) {
	// 【中継を連ねたuniformはOutに現れない】
	// 値の型によらず、公開出力のためのGPU資源を一つも確保しない。
	test('omits ' + kind + ' uniform outputs through relay chains without allocation', async t => {
		const f = setup([relay('first', publicInput, kind), relay('last', reference('first'), kind)], reference('last'), kind);
		const input = { kind: 'uniform', value };
		const instance = await f.place(input); t.after(() => instance.dispose());
		instance.render(frame(), {});
		assert.equal(instance.outputs.has('result'), false);
		assert.equal(f.textures.length, 0);
	});
}

// 【借用画像の寿命を中継が引き取らない】
// 配置の破棄時に、上流の所有者が使うテクスチャを破棄してはいけない。
test('passes borrowed textures through unchanged without destroying them', async () => {
	const input = { kind: 'texture', resolution: size, texture: { destroy: () => assert.fail('borrowed texture') } };
	const f = setup([relay('last')]), instance = await f.place(input);
	assert.equal(instance.outputs.get('result').texture, input.texture);
	instance.dispose(); assert.equal(f.textures.length, 0);
});

// 【複数の消費側で上流の描画を一度だけ共有する】
// 同じポートでもサンプリングは各接続に属し、片方の設定がもう片方へ漏れてはいけない。
test('preserves consumer sampling and renders a shared upstream effect once', async t => {
	const nearest = { fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' };
	const f = setup([node('source'), relay('split', reference('source', 'extra')),
		node('consumer', { a: connection('split', 'output', nearest), b: connection('split') })]);
	const instance = await f.place(color); t.after(() => instance.dispose());
	const current = frame(); await instance.prepare(current); instance.render(current, {});
	assert.equal(f.preparations.length, 2); assert.equal(f.renders.length, 2);
	const { a, b } = f.renders[1].inputs;
	assert.equal(a.texture, f.renders[0].outputTextures.get('extra'));
	assert.equal(a.texture, b.texture); assert.deepEqual(a.sampling, nearest); assert.deepEqual(b.sampling, sampling);
});

// 【中継先のポートを変えた配置は、新しい出力だけを確保する】
// 一つの配置の寿命中はポート固定なので、再配線時の確保と解放を別配置の境界で確認する。
test('tracks requested outputs through relay chains and port changes', async () => {
	const f = setup([node('source'), relay('last', reference('source', 'extra'))]);
	for (const port of ['extra', 'output']) {
		f.graph.nodes[1].input = reference('source', port);
		const instance = await f.place(color);
		assert.equal(instance.outputs.get('result').texture.port, port);
		instance.render(frame(), {}); instance.dispose();
	}
	assert.deepEqual(f.textures.map(texture => [texture.port, texture.destroyed]), [['extra', 1], ['output', 1]]);
});

// 【中継経由のuniform値が変わると後段だけを再描画する】
// 同じ値の再描画はキャッシュできる一方、変更された値をキャッシュで隠さない。
test('invalidates consumer caches on uniform changes through a relay', async t => {
	let value = color.value;
	const f = setup([relay('split'), node('consumer', { a: connection('split') })]);
	const instance = await f.place({ kind: 'uniform', get value() { return value; } }); t.after(() => instance.dispose());
	instance.render(frame(), {}); instance.render(frame(), {});
	assert.equal(f.renders.length, 1);
	value = [1, 0, 0, 1]; instance.render(frame(), {});
	assert.equal(f.renders.length, 2);
});

// 【世代のない借用画像は同じオブジェクトでも再描画する】
// WebGPUテクスチャは参照を変えずに画素を更新できるため、静止画とみなさない。
test('keeps consumers live when a borrowed texture retains its identity', async t => {
	const f = setup([relay('split'), node('consumer', { a: connection('split') })]);
	const instance = await f.place({ kind: 'texture', resolution: size, texture: {} }); t.after(() => instance.dispose());
	instance.render(frame(), {}); instance.render(frame(), {}); assert.equal(f.renders.length, 2);
});

// 【バイパスの前後にある中継は主入力を直結する】
// 無効化したノードが画像を再生成したり、その履歴を進めたりしない。
test('resolves relays on both sides of a bypassed effect', async t => {
	const f = setup([relay('first'), node('bypass', { a: connection('first') }, true), relay('last', reference('bypass'))]);
	const texture = {};
	const instance = await f.place({ kind: 'texture', resolution: size, texture }); t.after(() => instance.dispose());
	instance.render(frame(), {});
	assert.equal(instance.outputs.get('result').texture, texture);
	assert.deepEqual(f.renders, []);
	assert.deepEqual(f.textures, []);
});

for (const [label, source] of [['missing node', reference('removed')], ['missing public input', { parameterId: 'removed' }], ['unknown relay port', reference('first', 'removed')]]) {
	// 【参照できない中継先を編集境界で拒否する】
	// 不正な参照を既定の接続へ読み替えず、GPUを確保する前に修正できる。
	test('rejects ' + label + ' at the graph editing boundary', () => {
		const f = setup([relay('first'), relay('last', source)]);
		assert.throws(f.validate);
	});
}

// 【any型の中継を挟んでもテクスチャを変換しない】
// 互換性があるポートを経由するとき、スカラーテクスチャをそのまま借用する。
test('honors any compatibility without converting the output', async t => {
	const f = setup([relay('first', publicInput, 'any'), relay('last', reference('first'), 'scalar')], reference('last'), 'scalar');
	f.validate();
	const input = { kind: 'texture', resolution: size, texture: { format: 'r16float' } };
	const instance = await f.place(input); t.after(() => instance.dispose());
	assert.equal(instance.outputs.get('result'), input);
});
