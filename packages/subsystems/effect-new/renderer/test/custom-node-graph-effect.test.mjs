import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['src/create-effect-instance.ts'],
	bundle: true, format: 'esm', platform: 'node', write: false, loader: { '.wgsl': 'text' },
});
const { createEffectInstance } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

const scalar = { kind: 'scalar' };
const scalarParameter = { dataType: scalar, canNode: true, defaultValue: { inputSource: 'literal', value: 0 }, ui: { label: 'Value', control: { controlType: 'number' } } };
const uniform = value => ({ kind: 'uniform', value: [value] });
const nativeEffect = id => ({ type: 'nativeEffect', id });
const graphReference = id => ({ type: 'customNodeGraphEffectReference', id });
const inlineGraph = graph => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph });
const fromNode = (nodeId, outputPort) => ({ inputSource: 'node', nodeId, outputPort });
const fromPublic = parameterId => ({ inputSource: 'publicParameter', parameterId });
const sample = (requested, params = {}) => ({ params, commandEncoder: {}, requestedOutputIds: new Set(requested), time: 0, timeDelta: 0 });
const options = { device: {}, resolution: { width: 320, height: 180 }, inputKinds: {} };
function definition(outputIds, paramDefs = {}) {
	return {
		kind: 'generate', paramDefs, outputDefs: Object.fromEntries(outputIds.map(id => [id, { dataType: scalar }])),
		primaryInputParameter: null, resolutionInputParameters: Object.keys(paramDefs), primaryOutput: outputIds[0],
	};
}
function graph(nodes, outputs, paramDefs = {}) {
	return { ...definition(Object.keys(outputs), paramDefs), nodes, outputs };
}
function catalog(nativeEffects, nativeEffectImplementations, customNodeGraphEffects = []) {
	return { nativeEffects: new Map(nativeEffects), nativeEffectImplementations: new Map(nativeEffectImplementations),
		customShaderEffects: new Map(), customNodeGraphEffects: new Map(customNodeGraphEffects) };
}

// 【親の分岐をまたいで子の複数出力を一度だけ同期描画する】
// 参照とインラインのどちらから使っても配置ごとの履歴を持ち、同じ配置の副出力を読んでも余分に進めない。
test('renders nested fan-out synchronously and isolates history per placement', async () => {
	const evaluations = [];
	let instances = 0;
	const effects = catalog(
		[['counter', definition(['first', 'second'])], ['read', definition(['value'], { input: scalarParameter })]],
		[
			['counter', () => {
				const placement = ++instances;
				let count = 0;
				return {
					getOutputKind: () => 'uniform',
					getOutputResolution: () => null,
					render({ requestedOutputIds }) {
						count++;
						evaluations.push([placement, [...requestedOutputIds]]);
						return new Map([...requestedOutputIds].map(id => [id, uniform(count * (id === 'first' ? 1 : 10))]));
					},
					dispose() {},
				};
			}],
			['read', childOptions => ({
				getOutputKind: () => childOptions.inputKinds.input,
				getOutputResolution: () => null,
				render: context => new Map([['value', context.params.input]]),
				dispose() {},
			})],
		],
	);
	const child = graph([{ id: 'history', effectSource: nativeEffect('counter'), params: {} }], {
		a: fromNode('history', 'first'), b: fromNode('history', 'second'),
	});
	effects.customNodeGraphEffects.set('child', child);
	const parent = graph([
		{ id: 'a', effectSource: nativeEffect('read'), params: { input: fromNode('left', 'a') } },
		{ id: 'b', effectSource: nativeEffect('read'), params: { input: fromNode('left', 'b') } },
		{ id: 'left', effectSource: graphReference('child'), params: {} },
		{ id: 'right', effectSource: inlineGraph(child), params: {} },
	], { x: fromNode('a', 'value'), y: fromNode('b', 'value'), independent: fromNode('right', 'a') });
	const instance = await createEffectInstance(inlineGraph(parent), options, effects);
	assert.deepEqual(evaluations, []);
	assert.deepEqual(['x', 'y', 'independent'].map(id => instance.getOutputKind(id)), ['uniform', 'uniform', 'uniform']);
	const outputs = instance.render(sample(['x', 'y']));
	assert.ok(outputs instanceof Map);
	assert.deepEqual([outputs.get('x').value[0], outputs.get('y').value[0]], [1, 10]);
	assert.deepEqual(evaluations, [[1, ['first', 'second']]]);
	const next = instance.render(sample(['independent', 'y']));
	assert.deepEqual([next.get('independent').value[0], next.get('y').value[0]], [1, 20]);
	assert.deepEqual(evaluations.slice(1), [[2, ['first']], [1, ['second']]]);
	instance.dispose();
});

// 【公開ポートごとの寸法と借用画像を保ち、画像を読む接続でサンプリングを指定する】
// 入れ子の主出力の寸法で全ポートを上書きしたり、グラフ境界を越えるだけで画像を書き直したりしない。
test('preserves borrowed outputs, per-port sizes and sampling at the consuming edge', async () => {
	const sampling = { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' };
	const publicSize = { width: 91, height: 37 };
	const fixedSize = { width: 12, height: 17 };
	const borrowed = { kind: 'texture', texture: {} };
	let seen;
	const readerInputKinds = [];
	const effects = catalog([['read', definition(['value'], { input: scalarParameter })]], [['read', childOptions => {
		readerInputKinds.push(childOptions.inputKinds.input);
		return {
			getOutputKind: () => 'texture', getOutputResolution: () => childOptions.resolution,
			render({ params }) {
				seen = params.input;
				return new Map([['value', { kind: 'texture', texture: {} }]]);
			},
			dispose() {},
		};
	}]]);
	const child = graph([{ id: 'reader', effectSource: nativeEffect('read'), params: { input: { ...fromPublic('image'), sampling } }, resolution: fixedSize }],
		{ original: fromPublic('image'), processed: fromNode('reader', 'value') }, { image: scalarParameter });
	const parent = graph([{ id: 'child', effectSource: inlineGraph(child), params: { image: fromPublic('source') } }],
		{ original: fromNode('child', 'original'), processed: fromNode('child', 'processed') }, { source: scalarParameter });
	parent.outputDefs.empty = { dataType: scalar };
	const instance = await createEffectInstance(inlineGraph(parent), { ...options, inputKinds: { source: 'texture' }, inputResolutions: new Map([['source', publicSize]]) }, effects);
	assert.equal(instance.getOutputKind('original'), 'texture');
	assert.equal(instance.getOutputKind('processed'), 'texture');
	assert.equal(instance.getOutputKind('empty'), null);
	assert.deepEqual(instance.getOutputResolution('original'), publicSize);
	assert.deepEqual(instance.getOutputResolution('processed'), fixedSize);
	assert.equal(instance.getOutputResolution('empty'), null);
	const outputs = instance.render(sample(['original', 'processed', 'empty'], { source: { ...borrowed, fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' } }));
	assert.deepEqual(outputs.get('original'), borrowed);
	assert.equal(outputs.get('original').texture, borrowed.texture);
	assert.equal(outputs.has('empty'), false);
	assert.deepEqual(seen, { ...borrowed, ...sampling });
	// 同じ定義の別配置では定数として準備でき、先に作った配置は引き続きテクスチャを扱う。
	const uniformInstance = await createEffectInstance(inlineGraph(parent), { ...options, inputKinds: { source: 'uniform' } }, effects);
	assert.deepEqual(readerInputKinds, ['texture', 'uniform']);
	assert.equal(instance.getOutputKind('original'), 'texture');
	assert.equal(uniformInstance.getOutputKind('original'), 'uniform');
	assert.equal(uniformInstance.getOutputKind('processed'), 'texture');
	const constant = uniform(8);
	assert.equal(uniformInstance.render(sample(['original'], { source: constant })).get('original'), constant);
	uniformInstance.dispose();
	instance.dispose();
});

// 【構造体内の配列要素も接続元・解像度・入力値として扱う】
// コンテナの末端の参照を見落とすと、入力元が未描画のままになる。既定値も同じBindingの構造で評価する。
test('resolves nested connections, container defaults and the largest input size', async () => {
	const literal = value => ({ inputSource: 'literal', value });
	const elements = (...bindings) => literal(bindings.map((binding, index) => ({ id: String(index), binding })));
	const container = {
		dataType: { kind: 'struct', fields: { values: { kind: 'array', elementType: scalar }, enabled: { kind: 'bool' } } },
		ui: { label: 'Items', control: { fields: { values: { label: 'Values', control: { element: { controlType: 'number' } } }, enabled: { label: 'Enabled', control: {} } } } },
		defaultValue: literal({ values: elements(literal(2)), enabled: literal(true) }),
		fields: { values: { defaultValue: elements(), element: { canNode: true, defaultValue: literal(0) } }, enabled: { defaultValue: literal(true) } },
	};
	const upstreamSize = { width: 192, height: 108 };
	const upstreamTexture = { kind: 'texture', texture: {} };
	let inputs;
	let kinds;
	const effects = catalog([['read', definition(['out'], { bound: container, baseline: container })], ['source', definition(['out'])]], [
		['source', () => ({ getOutputKind: () => 'texture', getOutputResolution: () => upstreamSize, render: () => new Map([['out', upstreamTexture]]), dispose() {} })],
		['read', childOptions => ({
			getOutputKind: () => childOptions.inputKinds.bound.values[0],
			getOutputResolution: () => childOptions.resolution,
			render({ params }) {
				inputs = params;
				kinds = childOptions.inputKinds;
				return new Map([['out', params.bound.values[0]]]);
			},
			dispose() {},
		})],
	]);
	const empty = graph([], {});
	empty.outputDefs.none = { dataType: scalar };
	const parent = graph([
		{ id: 'reader', effectSource: nativeEffect('read'), params: {
			bound: literal({ values: elements(fromNode('upstream', 'out'), fromPublic('other'), literal(5), fromNode('empty', 'none'), fromPublic('amount')), enabled: literal(false) }),
		} },
		{ id: 'upstream', effectSource: nativeEffect('source'), params: {} },
		{ id: 'empty', effectSource: inlineGraph(empty), params: {} },
	], { result: fromNode('reader', 'out') }, { other: scalarParameter, amount: { ...scalarParameter, canNode: false } });
	const instance = await createEffectInstance(inlineGraph(parent), { ...options, inputKinds: { other: 'texture' } }, effects);
	assert.deepEqual(instance.getOutputResolution('result'), upstreamSize);
	assert.equal(instance.getOutputKind('result'), 'texture');
	const other = { kind: 'texture', texture: {}, fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' };
	instance.render(sample(['result'], { other, amount: 3 }));
	assert.deepEqual(kinds.bound, { values: ['texture', 'texture', 'uniform', 'uniform', 'uniform'], enabled: null });
	assert.deepEqual(kinds.baseline, { values: ['uniform'], enabled: null });
	assert.equal(inputs.bound.values[0].texture, upstreamTexture.texture);
	assert.equal(inputs.bound.values[1].texture, other.texture);
	assert.deepEqual(inputs.bound.values.slice(2).map(value => value.value[0]), [5, 0, 3]);
	assert.deepEqual(inputs.baseline.values.map(value => value.value[0]), [2]);
	instance.dispose();
});

// 【外部から渡す配列入力の種類を配置時に固定する】
// ホストが設定を編集しても稼働中の配置には影響させず、異なる種類・形のフレームで履歴を進めない。
test('fixes public array input kinds before the first frame and protects render history', async () => {
	const values = {
		dataType: { kind: 'array', elementType: scalar },
		element: scalarParameter,
		defaultValue: { inputSource: 'literal', value: [] },
		ui: { label: 'Values', control: { element: { controlType: 'number' } } },
	};
	let rendered = 0;
	const effects = catalog([['first', definition(['out'], { values })]], [['first', placement => ({
		getOutputKind: () => placement.inputKinds.values[0],
		getOutputResolution: () => null,
		render({ params }) {
			rendered++;
			return new Map([['out', params.values[0]]]);
		},
		dispose() {},
	})]]);
	const source = nativeEffect('first');
	await assert.rejects(createEffectInstance(source, options, effects), /fixed input kind for values/);
	const inputKinds = { values: ['uniform', 'texture'] };
	const instance = await createEffectInstance(source, { ...options, inputKinds }, effects);
	inputKinds.values[0] = 'texture';
	assert.equal(instance.getOutputKind('out'), 'uniform');
	const constant = uniform(2);
	assert.throws(() => instance.render(sample(['out'], { values: [constant, constant] })), /values\[1\] requires texture/);
	assert.throws(() => instance.render(sample(['out'], { values: [constant] })), /array length changed: values/);
	assert.equal(rendered, 0);
	const texture = { kind: 'texture', texture: {}, fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' };
	assert.equal(instance.render(sample(['out'], { values: [constant, texture] })).get('out'), constant);
	assert.equal(rendered, 1);
	instance.dispose();
});

// 【子の非同期準備に失敗したら、準備済みの配置を解放する】
// 参照先のWGSLなどを直して再試行する際に、失敗した生成から所有リソースを残さない。
test('disposes prepared siblings when child initialization fails', async () => {
	let disposed = 0;
	const error = new Error('pipeline creation failed');
	const effects = catalog([['ready', definition(['out'])], ['failed', definition(['out'])]], [
		['ready', () => ({ getOutputKind: () => null, getOutputResolution: () => null, render: () => new Map(), dispose() { disposed++; } })],
		['failed', async () => { throw error; }],
	]);
	const parent = graph([{ id: 'ready', effectSource: nativeEffect('ready'), params: {} }, { id: 'failed', effectSource: nativeEffect('failed'), params: {} }],
		{ ready: fromNode('ready', 'out'), failed: fromNode('failed', 'out') });
	await assert.rejects(createEffectInstance(inlineGraph(parent), options, effects), error);
	assert.equal(disposed, 1);
});
