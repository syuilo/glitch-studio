import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createCustomNodeGraphEffectInstance } from '../src/custom-node-graph-effect/custom-node-graph-effect-instance.ts';

const literal = value => ({ inputSource: 'literal', value });
const parameter = { dataType: { kind: 'scalar' }, canNode: true, defaultValue: literal(7), ui: { label: 'Value', control: { controlType: 'number' } } };
const output = { dataType: { kind: 'scalar' } };
const fromNode = (nodeId, outputPort) => ({ inputSource: 'node', nodeId, outputPort });
const fromPublic = parameterId => ({ inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId });
const nativeNode = (id, nativeId, params = {}) => ({ id, effectSource: { type: 'nativeEffect', id: nativeId }, params });
const nestedNode = (id, graphId, params = {}) => ({ id, effectSource: { type: 'customNodeGraphEffectReference', id: graphId }, params });
const definition = (params = [], outputs = []) => ({
	kind: 'generate', paramDefs: Object.fromEntries(params.map(id => [id, parameter])), outputDefs: Object.fromEntries(outputs.map(id => [id, output])),
	primaryInputParameter: null, primaryOutput: null, resolutionInputParameters: [],
});
const options = requestedOutputIds => ({ requestedOutputIds, inputLayouts: {}, resolution: { width: 100, height: 100 } });
const frame = (time, parameters = {}) => ({ commandEncoder: {}, time, parameters });
const uniform = value => ({ kind: 'uniform', value: [value] });
const uniformLayout = { kind: 'uniform' };
const resolver = (native, graphs = {}) => source => resolveEffectSource(source, {
	getNativeEffectDefinition: id => native[id] ?? null, getCustomNodeGraphEffect: id => graphs[id] ?? null,
});

// 【子の複数出力に到達する全配線を集めてから、上流を一度だけ正しい順序で描画する】
// 一方の出力から先に子を発見しても、別出力に必要な上流が子の後に並んではならない。
// 逆に、要求しない子の出力にしか使わない親の上流は、定義の解決もインスタンス生成も不要。
test('collects nested output demands before ordering shared dependencies and prunes unused public inputs', async () => {
	const child = { ...definition(['first', 'second', 'unused'], ['x', 'y', 'z']), nodes: [],
		outputs: { x: fromPublic('first'), y: fromPublic('second'), z: fromPublic('unused') } };
	const root = { ...definition([], ['direct', 'one', 'two']), nodes: [
		nestedNode('child', 'registered', { first: fromNode('generator', 'a'), second: fromNode('other', 'c'), unused: fromNode('unused', 'port') }),
		nativeNode('unused', 'missing'), nativeNode('other', 'other', { source: fromNode('generator', 'b') }), nativeNode('generator', 'generator'),
	], outputs: { direct: fromNode('generator', 'a'), one: fromNode('child', 'x'), two: fromNode('child', 'y') } };
	const created = [], rendered = [], disposed = [];
	const graph = await createCustomNodeGraphEffectInstance(root, options(['one', 'two', 'direct']), resolver({
		generator: definition([], ['a', 'b', 'c']), other: definition(['source'], ['c']),
	}, { registered: child }), async (source, placement) => {
		created.push([source.id, placement.requestedOutputIds]);
		let history = 0;
		return {
			outputLayouts: Object.fromEntries(placement.requestedOutputIds.map(id => [id, uniformLayout])),
			render: frame => {
				rendered.push(source.id);
				history++;
				return source.id === 'generator' ? { a: uniform(history), b: uniform(history + 10) } : { c: uniform(frame.parameters.source.value[0] * 2) };
			},
			dispose: () => disposed.push(source.id),
		};
	});
	assert.deepEqual(created, [['generator', ['a', 'b']], ['other', ['c']]]);
	assert.deepEqual(graph.outputLayouts, { one: uniformLayout, two: uniformLayout, direct: uniformLayout });
	for (let i = 1; i <= 2; i++) {
		const value = graph.render(frame(i));
		assert.equal(value.one.value[0], i);
		assert.equal(value.two.value[0], (i + 10) * 2);
		assert.equal(value.direct.value[0], i);
	}
	assert.deepEqual(rendered, ['generator', 'other', 'generator', 'other']);
	graph.dispose();
	assert.deepEqual(disposed, ['other', 'generator']);
});

// 【同じ登録定義の別配置は、解像度・入力表現・履歴を別々に保持する】
// 同一フレームの描画回数と、uniform/textureを読むポートの固定区分を配置間で共有してはならない。
test('keeps instances independent and applies sampling where each nested texture connection is read', async () => {
	const child = { ...definition(['in'], ['out']), nodes: [nativeNode('effect', 'measure', {
		in: { ...fromPublic('in'), fitMode: 'contain', filterMode: 'nearest', wrapMode: 'transparent' },
	})], outputs: { out: fromNode('effect', 'out') } };
	const root = { ...definition(['image'], ['image', 'constant']), nodes: [
		nestedNode('textured', 'same', { in: fromPublic('image') }), nestedNode('uniform', 'same', { in: literal(2) }),
	], outputs: { image: fromNode('textured', 'out'), constant: fromNode('uniform', 'out') } };
	const textureLayout = { kind: 'texture', resolution: { width: 12, height: 8 } };
	const setups = [], observed = [];
	const graph = await createCustomNodeGraphEffectInstance(root, { ...options(['image', 'constant']), inputLayouts: { image: textureLayout } },
		resolver({ measure: { ...definition(['in'], ['out']), resolutionInputParameters: ['in'] } }, { same: child }), async (source, placement) => {
			setups.push([placement.inputLayouts.in, placement.resolution]);
			let history = 0;
			return { outputLayouts: { out: uniformLayout }, render: frame => {
				observed.push(frame.parameters.in);
				return { out: uniform(++history) };
			}, dispose() {} };
		});
	assert.deepEqual(setups, [[textureLayout, textureLayout.resolution], [uniformLayout, { width: 100, height: 100 }]]);
	for (let i = 1; i <= 2; i++) {
		const texture = { id: i };
		const values = graph.render(frame(i, { image: { kind: 'texture', texture, fitMode: 'stretch', filterMode: 'linear', wrapMode: 'clamp' } }));
		assert.deepEqual(values, { image: uniform(i), constant: uniform(i) });
		assert.deepEqual(observed.at(-2), { kind: 'texture', texture, fitMode: 'contain', filterMode: 'nearest', wrapMode: 'transparent' });
	}
	graph.dispose();
});

// 【未接続の公開出力は省き、それを入力に使う配置は自身の既定のuniformへ戻す】
// 仮のテクスチャを割り当てたり、利用者の指定とは異なる子の主出力に切り替えたりしない。
test('fixes disconnected nested outputs to the consuming input fallback before initialization', async () => {
	const empty = { ...definition([], ['missing']), nodes: [], outputs: {} };
	const root = { ...definition([], ['missing', 'result']), nodes: [nestedNode('child', 'empty'), nativeNode('use', 'read', {
		source: fromNode('child', 'missing'),
	})], outputs: { missing: fromNode('child', 'missing'), result: fromNode('use', 'out') } };
	const graph = await createCustomNodeGraphEffectInstance(root, options(['missing', 'result']), resolver({ read: definition(['source'], ['out']) }, { empty }),
		async (source, placement) => {
			assert.deepEqual(placement.inputLayouts, { source: uniformLayout });
			return { outputLayouts: { out: uniformLayout }, render: frame => ({ out: frame.parameters.source }), dispose() {} };
		});
	assert.deepEqual(graph.outputLayouts, { result: uniformLayout });
	assert.deepEqual(graph.render(frame(0)), { result: uniform(7) });
	graph.dispose();
});

// 【配列内のテクスチャから決めた描画寸法を、子の式評価にも渡す】
// コンテナ自体はCPU値でも、異なる寸法の画像が混在する。公開画像を直接配線する場合と同じく、
// 描画前に最大の画素数を選び、子のスコープで毎フレーム評価する式にもその寸法を提供する。
test('plans resolutions from connected array elements and evaluates dynamic bindings inside the nested placement scope', async () => {
	const images = { dataType: { kind: 'array', elementType: parameter.dataType }, element: parameter,
		ui: { label: 'Images', control: { element: parameter.ui.control } }, defaultValue: literal([]) };
	const speed = { ...parameter, canNode: false };
	const effect = { ...definition([], ['value']), paramDefs: { images, speed }, resolutionInputParameters: ['images'] };
	const child = { ...definition(['small', 'large'], ['result']), nodes: [nativeNode('measuring', 'measure', {
		images: literal(['small', 'large'].map(id => ({ id, binding: fromPublic(id) }))), speed: { inputSource: 'expression', expression: 'speed * time' },
	})], outputs: { result: fromNode('measuring', 'value') } };
	child.paramDefs.speed = speed;
	const root = { ...definition(['a', 'b'], ['result']), nodes: [nestedNode('measure-child', 'child', {
		small: fromPublic('a'), large: fromPublic('b'), speed: literal(3),
	})], outputs: { result: fromNode('measure-child', 'result') } };
	const small = { width: 4, height: 8 }, large = { width: 6, height: 6 };
	const graph = await createCustomNodeGraphEffectInstance(root, { ...options(['result']), inputLayouts: {
		a: { kind: 'texture', resolution: small }, b: { kind: 'texture', resolution: large },
	} }, resolver({ measure: effect }, { child }), async (_source, placement) => {
		assert.deepEqual(placement.resolution, large);
		assert.deepEqual(placement.inputLayouts, { images: { kind: 'value' }, speed: { kind: 'value' } });
		return { outputLayouts: { value: uniformLayout }, render: frame => {
			assert.deepEqual(frame.parameters.images.map(image => image.texture.id), ['a', 'b']);
			return { value: uniform(frame.parameters.speed) };
		}, dispose() {} };
	}, (binding, definition, context) => {
		assert.equal(binding.expression, 'speed * time');
		assert.equal(definition, speed);
		assert.equal(context.customNodeGraphEffect, child);
		assert.equal(context.node.id, 'measuring');
		assert.deepEqual(context.resolution, large);
		assert.equal(context.frame.parameters.speed, 3);
		return context.frame.parameters.speed * context.frame.time;
	});
	for (const time of [2, 4]) {
		assert.deepEqual(graph.render(frame(time, { a: { kind: 'texture', texture: { id: 'a' } }, b: { kind: 'texture', texture: { id: 'b' } } })),
			{ result: uniform(3 * time) });
	}
	graph.dispose();
});

// 【自動解像度だけに使う上流の履歴は進めず、同じポートを読む配線が加われば評価する】
// 子グラフは公開入力の画素を使わず寸法だけを引き継ぐ。別の子の公開出力を経由した供給元にも
// この区別を伝え、描画前のサイズ計画は維持しながら、不要な履歴更新とパラメータ式の評価を避ける。
test('uses nested producer layouts for auto resolution without rendering size-only inputs', async () => {
	const size = { width: 13, height: 21 };
	const producer = { ...definition([], ['sized']), nodes: [{ ...nativeNode('history', 'history', {
		speed: { inputSource: 'expression', expression: 'speed' },
	}), resolution: size }], outputs: { sized: fromNode('history', 'texture') } };
	const display = { ...definition(['sizing'], ['view']), resolutionInputParameters: ['sizing'], nodes: [nativeNode('view', 'view')],
		outputs: { view: fromNode('view', 'texture') } };
	const root = { ...definition([], ['visible', 'source']), nodes: [nestedNode('supply', 'producer'),
		nestedNode('display', 'display', { sizing: fromNode('supply', 'sized') })],
		outputs: { visible: fromNode('display', 'view'), source: fromNode('supply', 'sized') } };
	const resolve = resolver({ history: definition(['speed'], ['texture']), view: definition([], ['texture']) }, { producer, display });
	for (const readSource of [false, true]) {
		const requested = readSource ? ['visible', 'source'] : ['visible'];
		const renders = [], disposed = [];
		let evaluations = 0;
		const graph = await createCustomNodeGraphEffectInstance(root, options(requested), resolve, async (source, placement) => {
			assert.deepEqual(placement.resolution, size);
			return { outputLayouts: { texture: { kind: 'texture', resolution: placement.resolution } },
				render: () => {
					renders.push(source.id);
					return { texture: { kind: 'texture', texture: { source: source.id } } };
				}, dispose: () => disposed.push(source.id) };
		}, () => ++evaluations);
		assert.deepEqual(graph.outputLayouts.visible, { kind: 'texture', resolution: size });
		for (const time of [0, 1]) assert.equal(graph.render(frame(time)).visible.texture.source, 'view');
		assert.deepEqual(renders, readSource ? ['history', 'view', 'history', 'view'] : ['view', 'view']);
		assert.equal(evaluations, readSource ? 2 : 0);
		graph.dispose();
		assert.deepEqual(disposed.toSorted(), ['history', 'view']);
	}
});

// 【子の初期化に失敗したとき、既に生成した別の配置を破棄する】
// 非同期のシェーダーコンパイル失敗や素材読み込み失敗の後に、GPUリソースを残さない。
test('disposes initialized upstream instances when a downstream initializer fails', async () => {
	const disposed = [];
	const root = { ...definition([], ['out']), nodes: [nativeNode('upstream', 'first'), nativeNode('downstream', 'fail', { in: fromNode('upstream', 'out') })],
		outputs: { out: fromNode('downstream', 'out') } };
	await assert.rejects(createCustomNodeGraphEffectInstance(root, options(['out']), resolver({ first: definition([], ['out']), fail: definition(['in'], ['out']) }),
		async source => {
			if (source.id === 'fail') throw new Error('compile failure');
			return { outputLayouts: { out: uniformLayout }, render: () => ({ out: uniform(1) }), dispose: () => disposed.push(source.id) };
		}), /compile failure/);
	assert.deepEqual(disposed, ['first']);
});
