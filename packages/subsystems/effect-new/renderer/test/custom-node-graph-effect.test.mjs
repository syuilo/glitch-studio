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
const produced = (layout, read) => ({ layout, source: { type: 'produced', read } });
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
	let generatedPort;
	let generatedReads = 0;
	const graph = await createCustomNodeGraphEffectInstance(root, options(['one', 'two', 'direct']), resolver({
		generator: definition([], ['a', 'b', 'c']), other: definition(['source'], ['c']),
	}, { registered: child }), async (source, placement) => {
		created.push([source.id, placement.requestedOutputIds]);
		let history = 0;
		if (source.id === 'generator') {
			generatedPort = produced(uniformLayout, () => {
				generatedReads++;
				return uniform(history);
			});
			return {
				outputs: { a: generatedPort, b: produced(uniformLayout, () => uniform(history + 10)) },
				render() { rendered.push(source.id); history++; },
				dispose: () => disposed.push(source.id),
			};
		}
		let result = 0;
		return {
			outputs: { c: produced(uniformLayout, () => uniform(result)) },
			render: frame => {
				rendered.push(source.id);
				result = frame.parameters.source.value[0] * 2;
			},
			dispose: () => disposed.push(source.id),
		};
	});
	assert.deepEqual(created, [['generator', ['a', 'b']], ['other', ['c']]]);
	// 子の公開入力を経由した出力も、初期化の時点で生成元自身の読み取り口を共有する。
	assert.equal(graph.outputs.one.source, generatedPort.source);
	assert.equal(graph.outputs.direct.source, generatedPort.source);
	assert.deepEqual(graph.outputs.two.layout, uniformLayout);
	for (let i = 1; i <= 2; i++) {
		const readsBeforeRender = generatedReads;
		assert.equal(graph.render(frame(i)), undefined);
		assert.equal(generatedReads, readsBeforeRender);
		assert.equal(graph.outputs.one.source.read().value[0], i);
		assert.equal(graph.outputs.two.source.read().value[0], (i + 10) * 2);
		assert.equal(graph.outputs.direct.source.read().value[0], i);
	}
	assert.deepEqual(rendered, ['generator', 'other', 'generator', 'other']);
	graph.dispose();
	assert.deepEqual(disposed, ['other', 'generator']);
});

// 【入れ子を通り抜ける公開出力は、呼び出し元の公開パラメータIDを初期化時に返す】
// uniformの値やtextureの参照が毎フレーム変わっても、供給元の公開パラメータは同じ。
// 直結した各境界で引数を読み戻すと、呼び出し元が既に持つ値を段数分複製してしまう。
test('resolves nested passthroughs to the outer parameter without reading changing textures or uniforms during render', async () => {
	const inner = { ...definition(['argument'], ['result']), nodes: [], outputs: { result: fromPublic('argument') } };
	const outer = { ...definition(['image', 'amount'], ['picture', 'number']), nodes: [
		nestedNode('imageChild', 'inner', { argument: fromPublic('image') }),
		nestedNode('numberChild', 'inner', { argument: fromPublic('amount') }),
	], outputs: { picture: fromNode('imageChild', 'result'), number: fromNode('numberChild', 'result') } };
	const root = { ...definition(['inputImage', 'inputAmount'], ['resultImage', 'resultAmount']), nodes: [
		nestedNode('outer', 'outer', { image: fromPublic('inputImage'), amount: fromPublic('inputAmount') }),
	], outputs: { resultImage: fromNode('outer', 'picture'), resultAmount: fromNode('outer', 'number') } };
	const textureLayout = { kind: 'texture', resolution: { width: 3, height: 7 } };
	const graph = await createCustomNodeGraphEffectInstance(root, {
		...options(['resultImage', 'resultAmount']), inputLayouts: { inputImage: textureLayout, inputAmount: uniformLayout },
	}, resolver({}, { inner, outer }), () => assert.fail('A passthrough does not need a leaf instance'));
	const { resultImage, resultAmount } = graph.outputs;
	assert.deepEqual(resultImage, { layout: textureLayout, source: { type: 'parameter', parameterId: 'inputImage' } });
	assert.deepEqual(resultAmount, { layout: uniformLayout, source: { type: 'parameter', parameterId: 'inputAmount' } });
	for (const time of [1, 2]) {
		const texture = { kind: 'texture', texture: { id: time } };
		const amount = uniform(time);
		let reads = 0;
		const parameters = {
			get inputImage() { reads++; return texture; },
			get inputAmount() { reads++; return amount; },
		};
		assert.equal(graph.render(frame(time, parameters)), undefined);
		assert.equal(reads, 0);
		assert.equal(parameters[resultImage.source.parameterId], texture);
		assert.equal(parameters[resultAmount.source.parameterId], amount);
		assert.equal(reads, 2);
	}
	graph.dispose();
});

// 【Native Effectが公開する入力の別名も、同じ配置の計算出力と独立して直接配線する】
// 一つの配置に入力直結と計算済みの両方の出力があっても、別名を解決するための追加の引数読み取りや
// 描画は不要。計算結果だけがNative Effectの読み取り口に結び付く。
test('substitutes a native parameter alias alongside a produced output from the same placement', async () => {
	const root = { ...definition(['outer'], ['passthrough', 'computed']), nodes: [
		nativeNode('branch', 'branch', { input: fromPublic('outer') }),
	], outputs: { passthrough: fromNode('branch', 'forwarded'), computed: fromNode('branch', 'doubled') } };
	let doubled = 0;
	let renders = 0;
	const doubledPort = produced(uniformLayout, () => uniform(doubled));
	const createGraph = requested => createCustomNodeGraphEffectInstance(root, {
		...options(requested), inputLayouts: { outer: uniformLayout },
	}, resolver({ branch: definition(['input'], ['forwarded', 'doubled']) }), async () => ({
		outputs: {
			forwarded: { layout: uniformLayout, source: { type: 'parameter', parameterId: 'input' } },
			doubled: doubledPort,
		},
		render(frame) {
			renders++;
			doubled = 2 * frame.parameters.input.value[0];
		},
		dispose() {},
	}));
	const graph = await createGraph(['passthrough', 'computed']);
	assert.deepEqual(graph.outputs.passthrough.source, { type: 'parameter', parameterId: 'outer' });
	assert.equal(graph.outputs.computed.source, doubledPort.source);
	let reads = 0;
	graph.render(frame(0, { get outer() { reads++; return uniform(4); } }));
	assert.equal(renders, 1);
	assert.equal(reads, 1);
	assert.deepEqual(graph.outputs.computed.source.read(), uniform(8));
	graph.dispose();
	const passthrough = await createGraph(['passthrough']);
	passthrough.render(frame(1, { get outer() { assert.fail('A forwarded input is already owned by the caller'); } }));
	assert.equal(renders, 1);
	passthrough.dispose();
});

// 【式を割り当てた子の公開入力は出力と内部ノードで共有し、各描画で一度だけ評価する】
// 内部の消費者と親の二つの公開出力が同じ値を必要とする。出力を読む順序や回数が式の評価回数に
// 影響すると、配置に対する一回の評価結果を共有できなくなる。
test('evaluates a computed public argument once per render across forwarded outputs and an internal consumer', async () => {
	const child = { ...definition(['argument'], ['forwarded', 'processed']), nodes: [
		nativeNode('observer', 'double', { input: fromPublic('argument') }),
	], outputs: { forwarded: fromPublic('argument'), processed: fromNode('observer', 'doubled') } };
	const root = { ...definition([], ['first', 'second', 'processed']), nodes: [
		nestedNode('child', 'child', { argument: { inputSource: 'expression', expression: 'gain * time' } }),
	], outputs: { first: fromNode('child', 'forwarded'), second: fromNode('child', 'forwarded'), processed: fromNode('child', 'processed') } };
	root.paramDefs.gain = { ...parameter, canNode: false };
	let evaluations = 0;
	const observed = [];
	const graph = await createCustomNodeGraphEffectInstance(root, {
		...options(['first', 'second', 'processed']), inputLayouts: { gain: { kind: 'value' } },
	}, resolver({ double: definition(['input'], ['doubled']) }, { child }), async () => {
		let result;
		return {
			outputs: { doubled: produced(uniformLayout, () => result) },
			render(frame) {
				const value = frame.parameters.input.value[0];
				observed.push(value);
				result = uniform(value * 2);
			},
			dispose() {},
		};
	}, (binding, _definition, context) => {
		assert.equal(context.customNodeGraphEffect, root);
		assert.equal(context.node.id, 'child');
		assert.equal(binding.expression, 'gain * time');
		evaluations++;
		return context.frame.parameters.gain * context.frame.time;
	});
	const { first, second, processed } = graph.outputs;
	for (const time of [1, 2]) {
		graph.render(frame(time, { gain: 3 }));
		assert.equal(evaluations, time);
		assert.equal(processed.source.read().value[0], time * 6);
		assert.equal(second.source.read().value[0], time * 3);
		assert.equal(first.source.read().value[0], time * 3);
		assert.equal(evaluations, time);
	}
	assert.deepEqual(observed, [3, 6]);
	graph.dispose();
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
			return { outputs: { out: produced(uniformLayout, () => uniform(history)) }, render: frame => {
				observed.push(frame.parameters.in);
				history++;
			}, dispose() {} };
		});
	assert.deepEqual(setups, [[textureLayout, textureLayout.resolution], [uniformLayout, { width: 100, height: 100 }]]);
	for (let i = 1; i <= 2; i++) {
		const texture = { id: i };
		graph.render(frame(i, { image: { kind: 'texture', texture, fitMode: 'stretch', filterMode: 'linear', wrapMode: 'clamp' } }));
		assert.deepEqual(graph.outputs.image.source.read(), uniform(i));
		assert.deepEqual(graph.outputs.constant.source.read(), uniform(i));
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
			let result;
			return { outputs: { out: produced(uniformLayout, () => result) }, render(frame) { result = frame.parameters.source; }, dispose() {} };
		});
	assert.deepEqual(Object.keys(graph.outputs), ['result']);
	assert.deepEqual(graph.outputs.result.layout, uniformLayout);
	graph.render(frame(0));
	assert.deepEqual(graph.outputs.result.source.read(), uniform(7));
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
	const child = { ...definition([], ['result']), paramDefs: { images, speed }, resolutionInputParameters: ['images'], nodes: [nativeNode('measuring', 'measure', {
		images: fromPublic('images'), speed: { inputSource: 'expression', expression: 'speed * time' },
	})], outputs: { result: fromNode('measuring', 'value') } };
	const root = { ...definition(['a', 'b'], ['result']), nodes: [nestedNode('measure-child', 'child', {
		images: literal([{ id: 'small', binding: { ...fromPublic('a'), filterMode: 'nearest' } },
			{ id: 'large', binding: fromPublic('b') }]), speed: literal(3),
	})], outputs: { result: fromNode('measure-child', 'result') } };
	const small = { width: 4, height: 8 }, large = { width: 6, height: 6 };
	const graph = await createCustomNodeGraphEffectInstance(root, { ...options(['result']), inputLayouts: {
		a: { kind: 'texture', resolution: small }, b: { kind: 'texture', resolution: large },
	} }, resolver({ measure: effect }, { child }), async (_source, placement) => {
		assert.deepEqual(placement.resolution, large);
		assert.deepEqual(placement.inputLayouts, { images: { kind: 'value' }, speed: { kind: 'value' } });
		let result;
		return { outputs: { value: produced(uniformLayout, () => result) }, render: frame => {
			assert.deepEqual(frame.parameters.images.map(image => image.texture.id), ['a', 'b']);
			assert.deepEqual(frame.parameters.images.map(image => image.filterMode), ['nearest', 'linear']);
			result = uniform(frame.parameters.speed);
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
		graph.render(frame(time, { a: { kind: 'texture', texture: { id: 'a' } }, b: { kind: 'texture', texture: { id: 'b' } } }));
		assert.deepEqual(graph.outputs.result.source.read(), uniform(3 * time));
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
			const texture = { kind: 'texture', texture: { source: source.id } };
			return { outputs: { texture: produced({ kind: 'texture', resolution: placement.resolution }, () => texture) },
				render() { renders.push(source.id); }, dispose: () => disposed.push(source.id) };
		}, () => ++evaluations);
		assert.deepEqual(graph.outputs.visible.layout, { kind: 'texture', resolution: size });
		for (const time of [0, 1]) {
			graph.render(frame(time));
			assert.equal(graph.outputs.visible.source.read().texture.source, 'view');
		}
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
			return { outputs: { out: produced(uniformLayout, () => uniform(1)) }, render() {}, dispose: () => disposed.push(source.id) };
		}), /compile failure/);
	assert.deepEqual(disposed, ['first']);
});
