import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 公開入口はCustom Shader EffectのWGSLも読み込む。描画回数と資源寿命の検証にはGPUを使わない。
const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/create-effect-instance.ts', import.meta.url))],
	bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' },
});
const { createEffectInstance } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

const scalarOutput = { dataType: { kind: 'scalar' } };
const scalarParameter = {
	...scalarOutput, canNode: true, defaultValue: { inputSource: 'literal', value: 0 },
	ui: { label: 'Input', control: { controlType: 'number' } },
};
const historyDefinition = {
	kind: 'generate', paramDefs: {}, outputDefs: { current: scalarOutput, previous: scalarOutput },
	primaryInputId: null, primaryOutputId: 'current',
};
const nodePort = (nodeId, outputPort) => ({ inputSource: 'node', nodeId, outputPort });
const publicParameter = parameterId => ({ inputSource: 'publicParameter', parameterId });
const historyNode = { id: 'history', effectSource: { type: 'nativeEffect', id: 'history' }, params: {} };
const historyGraph = {
	...historyDefinition, nodes: [historyNode],
	outputs: { current: nodePort('history', 'current'), previous: nodePort('history', 'previous') },
};
const uniform = value => ({ kind: 'uniform', value: [value] });
const request = (ids, params = {}) => ({ time: 0, timeDelta: 0, commandEncoder: {}, requestedOutputIds: new Set(ids), params });

function createHistoryFixture(definition) {
	const placements = [];
	const instance = createEffectInstance({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: definition }, {
		catalog: {
			nativeEffects: new Map([['history', historyDefinition]]), customShaderEffects: new Map(),
			customNodeGraphEffects: new Map([['historyGraph', historyGraph]]),
		},
		device: {}, resolution: { width: 23, height: 7 }, enable32bitDataTextures: false,
		nativeEffectImplementations: new Map([['history', () => {
			const events = { frames: 0, disposals: 0 };
			placements.push(events);
			return {
				getOutputResolution: () => null,
				async render({ requestedOutputIds }) {
					events.frames++;
					return new Map([...requestedOutputIds].map(id => [id, uniform(id === 'current' ? events.frames : events.frames - 1)]));
				},
				dispose() { events.disposals++; },
			};
		}]]),
	});
	return { instance, placements };
}

// 【描画に失敗した配置の履歴は再使用しない】
// 非同期の描画中に同じ配置を再評価すると履歴が二重に進む。重複要求だけを拒否し、
// 進行中の実装が失敗した場合は、部分的に更新した配置を破棄して元のエラーを返す。
test('rejects overlapping renders and releases an instance after a partial render failure', async () => {
	const pending = Promise.withResolvers();
	const error = new Error('Native Effect failed');
	let disposals = 0;
	const instance = createEffectInstance(historyNode.effectSource, {
		catalog: { nativeEffects: new Map([['history', historyDefinition]]), customShaderEffects: new Map(), customNodeGraphEffects: new Map() },
		device: {}, resolution: { width: 1, height: 1 }, enable32bitDataTextures: false,
		nativeEffectImplementations: new Map([['history', () => ({
			getOutputResolution: () => null,
			render: () => pending.promise,
			dispose() { disposals++; },
		})]]),
	});
	const first = instance.render(request(['current']));
	await assert.rejects(instance.render(request(['current'])), /already rendering/);
	assert.equal(disposals, 0);
	pending.reject(error);
	await assert.rejects(first, error);
	await assert.rejects(instance.render(request(['current'])), /disposed/);
	instance.dispose();
	assert.equal(disposals, 1);
});

// 【同じ子の複数出力をまとめて評価し、同じ登録定義でも配置ごとに履歴を持つ】
// 主出力・副出力の要求順や同じ出力の別名によって、子の描画回数が変わると履歴がずれる。
// 別の配置は後のフレームから使い始めても、その配置での初回の結果を返す。
test('evaluates all demanded ports once and isolates history by placement', async () => {
	const effectSource = { type: 'customNodeGraphEffectReference', id: 'historyGraph' };
	const { instance, placements } = createHistoryFixture({
		...historyGraph,
		nodes: [{ id: 'left', effectSource, params: {} }, { id: 'right', effectSource, params: {} }],
		outputDefs: { current: scalarOutput, previous: scalarOutput, alias: scalarOutput, right: scalarOutput },
		outputs: { current: nodePort('left', 'current'), previous: nodePort('left', 'previous'), alias: nodePort('left', 'current'), right: nodePort('right', 'current') },
	});
	const first = await instance.render(request(['previous', 'alias', 'current']));
	assert.deepEqual(first.get('previous'), uniform(0));
	assert.deepEqual(first.get('current'), uniform(1));
	assert.equal(first.get('alias'), first.get('current'));
	assert.deepEqual(placements.map(item => item.frames), [1]);
	const next = await instance.render(request(['right', 'current']));
	assert.deepEqual(next.get('right'), uniform(1));
	assert.deepEqual(next.get('current'), uniform(2));
	instance.dispose();
	instance.dispose();
	assert.deepEqual(placements, [{ frames: 2, disposals: 1 }, { frames: 1, disposals: 1 }]);
	await assert.rejects(instance.render(request(['current'])), /disposed/);
});

// 【入れ子の使わない公開入力へ接続した履歴は進めない】
// 子が公開入力を直結するだけなら親も借用値を返せる。別ポートのためだけにある
// Native Effectは、出力寸法の問い合わせでもインスタンスを確保しない。
test('passes through public values and leaves unused upstream history untouched', async () => {
	const child = {
		...historyDefinition, nodes: [], paramDefs: { first: scalarParameter, other: scalarParameter },
		outputs: { current: publicParameter('first'), previous: publicParameter('other') },
	};
	const { instance, placements } = createHistoryFixture({
		...historyDefinition, paramDefs: { value: scalarParameter },
		nodes: [historyNode, {
			id: 'child', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: child },
			params: { first: publicParameter('value'), other: nodePort('history', 'current') },
		}],
		outputs: { current: nodePort('child', 'current'), previous: nodePort('child', 'previous') },
	});
	const borrowed = uniform(17);
	assert.equal(instance.getOutputResolution('current'), null);
	const result = await instance.render(request(['current'], { value: borrowed }));
	assert.equal(result.get('current'), borrowed);
	assert.equal(placements.length, 0);
	assert.deepEqual((await instance.render(request(['previous']))).get('previous'), uniform(1));
	instance.dispose();
});

// 【画像を読む接続でサンプリングを選び、定数とテクスチャを同じチャンネル規則で読む】
// グラフの公開境界でフィルターを適用すると、同じテクスチャを異なる設定で読むことができない。
// scalarの定数もrテクスチャと同様、any入力で読む際には不足成分を(0, 0, 1)で補う。
test('applies sampling at each leaf and expands connected scalar uniforms like textures', async () => {
	const reader = {
		kind: 'modify', paramDefs: { value: { ...scalarParameter, dataType: { kind: 'any' }, defaultValue: { inputSource: 'literal', value: null } } },
		outputDefs: { out: { dataType: { kind: 'any' } } }, primaryInputId: 'value', primaryOutputId: 'out',
	};
	const nodes = ['nearest', 'linear'].map(filterMode => ({
		id: filterMode, effectSource: { type: 'nativeEffect', id: 'reader' },
		params: { value: { ...publicParameter('scalar'), sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode } } },
	}));
	const graph = {
		...reader, paramDefs: { scalar: scalarParameter }, primaryInputId: 'scalar', primaryOutputId: 'nearest', nodes,
		outputDefs: Object.fromEntries(nodes.map(node => [node.id, reader.outputDefs.out])),
		outputs: Object.fromEntries(nodes.map(node => [node.id, nodePort(node.id, 'out')])),
	};
	const inputs = [];
	const texture = {};
	const sourceSize = { width: 5, height: 7 };
	const instance = createEffectInstance({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }, {
		catalog: { nativeEffects: new Map([['reader', reader]]), customShaderEffects: new Map(), customNodeGraphEffects: new Map() },
		enable32bitDataTextures: false, device: {}, resolution: { width: 2, height: 1 }, getInputResolution: () => sourceSize,
		nativeEffectImplementations: new Map([['reader', options => ({
			getOutputResolution: () => options.getInputResolution('value'),
			async render({ params }) { inputs.push(params.value); return new Map([['out', uniform(0)]]); },
			dispose() {},
		})]]),
	});
	assert.deepEqual(instance.getOutputResolution('nearest'), sourceSize);
	await instance.render(request(['nearest'], { scalar: -3 }));
	assert.deepEqual(inputs.shift(), { kind: 'uniform', value: [-3, 0, 0, 1] });
	await instance.render(request(['nearest', 'linear'], { scalar: { kind: 'texture', texture } }));
	assert.deepEqual(inputs.map(input => [input.texture, input.fitMode, input.wrapMode, input.filterMode]), [
		[texture, 'stretch', 'clamp', 'nearest'], [texture, 'stretch', 'clamp', 'linear'],
	]);
	instance.dispose();
});
