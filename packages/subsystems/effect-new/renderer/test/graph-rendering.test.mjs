import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import { loadEffectNew } from './load-effect-new.mjs';

const { createEffectRenderInstance } = await loadEffectNew('../src/create-effect-render-instance.ts');
const { createCustomNodeGraphEffectRenderInstance } = await loadEffectNew('../src/custom-node-graph-effect/custom-node-graph-effect-renderer.ts');
const scalar = (canNode = true) => ({ dataType: { kind: 'scalar' }, canNode,
	ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } });
const output = { dataType: { kind: 'scalar' } };
const nodeOutput = (nodeId, outputId) => ({ type: 'nodeOutput', nodeId, outputId });
const publicParameter = parameterId => ({ type: 'publicParameter', parameterId });
const reference = id => ({ type: 'customNodeGraphEffectReference', id });
const leaf = { type: 'nativeEffect', id: 'instrumented' };
const inherited = { width: 16, height: 9 };
const request = (...outputIds) => ({ parameters: new Map(), outputIds: new Set(outputIds), time: 0, commandEncoder: {} });
const uniform = value => ({ kind: 'uniform', value: [value] });

// 【定義を一度検証して複数の寸法で配置し、GPUの寸法上限は配置ごとに検査する】
// 同じ定義を複数レイヤーで使うたびにグラフ全体を再検証すると、編集していない設定を繰り返し走査してしまう。
test('reuses caller validation across placements and enforces the device limit for each placement', t => {
	const catalog = new EffectCatalog();
	const source = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: {
		paramDefs: {}, outputDefs: {}, primaryInputId: null, primaryAudioInputId: null, primaryOutputId: null,
		nodes: [], outputs: {},
	} };
	const validate = t.mock.method(catalog, 'validate');
	catalog.validate(source);

	const environment = { device: { limits: { maxTextureDimension2D: 16 } } };
	const place = width => createEffectRenderInstance(catalog, source, environment, { resolution: { width, height: 1 } });
	place(8).destroy();
	place(16).destroy();
	assert.throws(() => place(17), /Invalid Effect resolution/);
	assert.equal(validate.mock.callCount(), 1);
});

// 【複数出力の要求を配置ごとにまとめ、履歴を独立させる】
// 同じグラフを二か所に置いても、公開ポートの個数・配線の合流・描画順が別配置の履歴を進めてはいけない。
// 使わない入れ子の入力に接続した枝は、準備の段階から処理の対象外になる。
test('groups requested ports across nested placements and advances each history once', async () => {
	const counted = { paramDefs: {}, outputDefs: { first: output, second: output } };
	const nested = {
		paramDefs: { unusedInput: scalar() }, outputDefs: { first: output, second: output, forwarded: output },
		nodes: [{ id: 'count', effect: leaf, params: {} }],
		outputs: { first: nodeOutput('count', 'first'), second: nodeOutput('count', 'second'), forwarded: publicParameter('unusedInput') },
	};
	const parent = {
		paramDefs: {}, outputDefs: { a: output, b: output, c: output },
		nodes: [
			{ id: 'left', effect: reference('nested'), params: { unusedInput: nodeOutput('unused', 'first') } },
			{ id: 'right', effect: reference('nested'), params: {} },
			{ id: 'unused', effect: leaf, params: {} },
		],
		outputs: { a: nodeOutput('left', 'first'), b: nodeOutput('left', 'second'), c: nodeOutput('right', 'first') },
	};
	const prepared = [];
	const rendered = [];
	const destroyed = [];
	const getDefinition = source => source.type === 'nativeEffect' ? counted : nested;
	const createChild = (source, options) => {
		if (source.type !== 'nativeEffect') return createCustomNodeGraphEffectRenderInstance(nested, options, getDefinition, createChild);
		let count = 0;
		return {
			async prepare(ids) { prepared.push([...ids].sort()); },
			render({ outputIds }) {
				count++;
				rendered.push([...outputIds].sort());
				return new Map([...outputIds].map(id => [id, uniform(count)]));
			},
			getOutputResolution: () => options.resolution,
			resetRenderHistory() { count = 0; },
			destroy() { destroyed.push(count); },
		};
	};
	const instance = createCustomNodeGraphEffectRenderInstance(parent, { resolution: inherited }, getDefinition, createChild);
	const frame = request('a', 'b', 'c');
	await instance.prepare(frame.outputIds);
	assert.deepEqual(prepared, [['first', 'second'], ['first']]);
	assert.equal(rendered.length, 0);
	assert.deepEqual([...instance.render(frame).values()], [uniform(1), uniform(1), uniform(1)]);
	assert.deepEqual(rendered, prepared);
	assert.deepEqual(instance.render(request('c')).get('c'), uniform(2));
	assert.deepEqual(instance.render(request('a')).get('a'), uniform(2));
	instance.resetRenderHistory();
	assert.deepEqual(instance.render(request('b')).get('b'), uniform(1));
	instance.destroy();
	instance.destroy();
	assert.equal(destroyed.length, 3);
});

// 【公開入力を素通しする子の出力寸法をポート別に親へ伝える】
// 描画前でも、明示寸法で描く兄弟ノードと借用した公開入力の寸法を同一グラフから別々に取得できる必要がある。
test('propagates distinct source resolutions and disconnected ports through a nested graph', () => {
	const definition = { paramDefs: {}, outputDefs: { first: output } };
	const nested = { paramDefs: { original: scalar() }, outputDefs: { forwarded: output, generated: output, empty: output },
		nodes: [{ id: 'generator', effect: leaf, params: {}, resolution: { width: 7, height: 5 } }],
		outputs: { forwarded: publicParameter('original'), generated: nodeOutput('generator', 'first') } };
	const parent = { paramDefs: { source: scalar() }, outputDefs: nested.outputDefs,
		nodes: [{ id: 'child', effect: reference('nested'), params: { original: publicParameter('source') } }],
		outputs: Object.fromEntries(Object.keys(nested.outputDefs).map(id => [id, nodeOutput('child', id)])) };
	const getDefinition = source => source.type === 'nativeEffect' ? definition : nested;
	const createChild = (source, options) => source.type === 'nativeEffect'
		? { getOutputResolution: () => options.resolution, resetRenderHistory() {}, destroy() {} }
		: createCustomNodeGraphEffectRenderInstance(nested, options, getDefinition, createChild);
	const external = { width: 192, height: 108 };
	const instance = createCustomNodeGraphEffectRenderInstance(parent, { resolution: inherited, inputResolutions: new Map([['source', external]]) }, getDefinition, createChild);
	assert.deepEqual(instance.getOutputResolution('forwarded'), external);
	assert.deepEqual(instance.getOutputResolution('generated'), { width: 7, height: 5 });
	assert.equal(instance.getOutputResolution('empty'), null);
	const frame = { ...request('forwarded', 'empty'), parameters: new Map([['source', uniform(5)]]) };
	assert.deepEqual([...instance.render(frame)], [['forwarded', uniform(5)]]);
	instance.destroy();
});

// 【子グラフの式が動的に選ぶPUBLICを子自身の引数から供給する】
// 親と子で同じIDの公開パラメータがあっても式の対象は配置に渡した値である。
// 公開値に対する明示的な配線が子内部になくても、式による読み出しを要求入力から落とさない。
test('keeps expression reads in the nested graph scope when pruning parameter dependencies', () => {
	const definition = { paramDefs: { amount: scalar(false) }, outputDefs: { data: output } };
	const spatialArray = { dataType: { kind: 'array', elementType: { kind: 'scalar' } }, element: scalar(),
		ui: { label: 'Inputs', control: { element: { controlType: 'number' } } }, defaultValue: { inputSource: 'literal', value: [] } };
	const nested = { paramDefs: { gain: scalar(false), image: scalar(), inputs: spatialArray }, outputDefs: { value: output },
		nodes: [{ id: 'reader', effect: leaf, resolution: { width: 5, height: 2 }, params: {
			amount: { type: 'value', binding: { inputSource: 'expression', expression: 'PUBLIC("gain") + RESOLUTION[0]' } },
		} }], outputs: { value: nodeOutput('reader', 'data') } };
	const parent = { paramDefs: { gain: scalar(false), argument: scalar(false), externalInputs: spatialArray }, outputDefs: nested.outputDefs,
		nodes: [{ id: 'child', effect: reference('nested'), params: { gain: publicParameter('argument'), inputs: publicParameter('externalInputs') } }],
		outputs: { value: nodeOutput('child', 'value') } };
	const getDefinition = source => source.type === 'nativeEffect' ? definition : nested;
	const createChild = (source, options) => source.type === 'nativeEffect'
		? { render({ parameters }) { return new Map([['data', uniform(parameters.get('amount'))]]); }, destroy() {} }
		: createCustomNodeGraphEffectRenderInstance(nested, options, getDefinition, createChild);
	const instance = createCustomNodeGraphEffectRenderInstance(parent, { resolution: inherited }, getDefinition, createChild);
	const frame = { ...request('value'), parameters: new Map([['gain', 990], ['argument', 7]]), expressionEngine: {
		evaluate(code, scope) {
			assert.equal(code, 'PUBLIC("gain") + RESOLUTION[0]');
			assert.throws(() => scope.functions.PUBLIC('inputs'), /Unavailable/);
			return scope.functions.PUBLIC('gain') + scope.variables.RESOLUTION[0];
		},
	} };
	assert.deepEqual([...instance.getRequiredParameterIds(frame.outputIds)], ['argument']);
	assert.deepEqual(instance.render(frame).get('value'), uniform(12));
	instance.destroy();
});

// 【定数を汎用ポートに転送するときに不足チャンネルを補う】
// 親がスカラーを定数で渡すかr形式のテクスチャで渡すかで、子が読む第4成分が変わらないことを確認する。
test('preserves single-channel texture semantics for uniform values forwarded to any ports', () => {
	const anyOutput = { dataType: { kind: 'any' } };
	const anyInput = { ...scalar(), dataType: { kind: 'any' } };
	const definition = { paramDefs: { data: anyInput }, outputDefs: { data: anyOutput } };
	const graph = { paramDefs: { value: scalar(), cpu: scalar(false) }, outputDefs: { direct: anyOutput, child: anyOutput },
		nodes: [{ id: 'reader', effect: leaf, params: { data: publicParameter('cpu') } }],
		outputs: { direct: publicParameter('value'), child: nodeOutput('reader', 'data') } };
	const instance = createCustomNodeGraphEffectRenderInstance(graph, { resolution: inherited }, () => definition, () => ({
		render: ({ parameters }) => new Map([['data', parameters.get('data')]]), destroy() {},
	}));
	const frame = { ...request('direct', 'child'), parameters: new Map([['value', uniform(8)], ['cpu', 3]]) };
	const values = instance.render(frame);
	assert.deepEqual(values.get('direct').value, [8, 0, 0, 1]);
	assert.deepEqual(values.get('child').value, [3, 0, 0, 1]);
	instance.destroy();
});

// 【途中で子の生成に失敗しても、先に作った配置を一度だけ破棄する】
// GPU確保中の失敗でコンストラクタが戻らない場合、呼び出し側からは作成済みの子にアクセスできない。
test('releases already created placements when creating a sibling fails', () => {
	const disposed = [];
	const definition = { paramDefs: {}, outputDefs: {} };
	const parent = { ...definition, nodes: ['one', 'two', 'three'].map(id => ({ id, effect: reference(id), params: {} })), outputs: {} };
	assert.throws(() => createCustomNodeGraphEffectRenderInstance(parent, { resolution: inherited }, () => definition, source => {
		if (source.id === 'three') throw new Error('allocation failed');
		return { destroy() { disposed.push(source.id); } };
	}), /allocation failed/);
	assert.deepEqual(disposed, ['two', 'one']);
});
