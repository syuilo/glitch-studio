import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	stdin: { resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), contents: `
		export { createEffectInstance } from './create-effect-instance.ts';
		export { createCustomNodeGraphEffectInstance } from './custom-node-graph-effect/create-custom-node-graph-effect-instance.ts';
	` },
	platform: 'node', format: 'esm', bundle: true, write: false,
});
const { createEffectInstance, createCustomNodeGraphEffectInstance } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

const sampling = { fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' };
const contextResolution = { width: 480, height: 320 };
const gpu = { device: { limits: { maxTextureDimension2D: 8192 } } };
const color = id => ({ id, nameForReference: id, dataType: { kind: 'color' }, canNode: true,
	ui: { label: id, control: {} }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } });
const connection = (nodeId, outputPort) => ({ nodeId, outputPort });
const wire = (nodeId, outputPort) => ({ inputSource: 'node', nodeId, outputPort, ...sampling });
const native = id => ({ type: 'nativeEffect', id });
const effectNode = (id, effectSource, params = {}) => ({ type: 'effect', id, effectSource, params,
	resolution: { mode: 'auto', scale: 1 }, isBypass: false, staticSettings: {}, displayName: id });
const globalIn = { type: 'globalIn', id: 'in' };
const globalOut = inputs => ({ type: 'globalOut', id: 'out', inputs });
function graph(nodes, parameters, outputs) {
	return { kind: 'modify', nodes, paramDefs: parameters.map(color), primaryInputId: parameters[0] ?? null, primaryOutputId: outputs[0] ?? null,
		outputDefs: outputs.map(id => ({ id, label: id, name: id, dataType: { kind: 'color' } })),
		customParameterDefs: [], customParameterValues: {}, automationGraphs: [] };
}
function definition(id, parameters, outputs) {
	return { id, kind: 'modify', paramDefs: Object.fromEntries(parameters.map(id => [id, color(id)])),
		outputDefs: Object.fromEntries(outputs.map(id => [id, { dataType: { kind: 'color' } }])),
		primaryInputParameter: parameters[0] ?? null, primaryOutput: outputs[0] ?? null, resolutionInputParameters: parameters };
}
function options(inputs, outputIds) {
	return { gpu, inputs, usedOutputPorts: new Set(outputIds), resolution: contextResolution, staticSettings: {} };
}
function environment(definitions, graphs = []) {
	return { catalog: { nativeEffects: new Map(definitions.map(definition => [definition.id, definition])),
		customNodeGraphEffects: new Map(graphs), customShaderEffects: new Map() }, nativeImplementations: new Map() };
}

// 描画時にuniformから1画素を生成するテスト用のEffect。グラフ出力の読み取りでは再評価しない。
function drawUniformToTexture(input, resolution, outputPort) {
	const texture = { pixel: null };
	const output = { kind: 'texture', resolution, read: () => ({ kind: 'texture', texture }) };
	return { outputs: { [outputPort]: output }, render(frame) { texture.pixel = input.read(frame).value; }, dispose() {} };
}

// 【省略した入力は、配置の初期化時にコンテナ全体の既定値から組み立てる】
// 要素追加用のテンプレートと配列に保存した初期値が異なる場合も、各フレームで同じuniformを再利用する。
test('materializes nested literal inputs from the root default once per placement', async () => {
	const literal = value => ({ inputSource: 'literal', value });
	const tint = color('tint');
	const entry = { dataType: { kind: 'struct', fields: { tint: tint.dataType } },
		ui: { label: 'Entry', control: { fields: { tint: tint.ui } } }, fields: { tint: { defaultValue: tint.defaultValue, canNode: true } },
		defaultValue: literal({ tint: tint.defaultValue }) };
	const entries = { dataType: { kind: 'array', elementType: entry.dataType }, ui: { label: 'Entries', control: { element: entry.ui.control } },
		element: { fields: entry.fields, defaultValue: entry.defaultValue }, defaultValue: literal([{ id: 'first', binding: literal({ tint: literal([1, 0, 0, 0.5]) }) }]) };
	const env = environment([{ ...definition('paint', [], ['out']), paramDefs: { entries } }]);
	env.nativeImplementations.set('paint', placement => {
		const input = placement.inputs.entries.elements[0].fields.tint;
		assert.equal(input.kind, 'uniform');
		assert.equal(input.read({ time: 0 }), input.read({ time: 1 }));
		return drawUniformToTexture(input, placement.resolution, 'out');
	});
	const instance = await createEffectInstance(native('paint'), options({}, ['out']), env);
	const frame = { time: 2 };
	instance.render(frame);
	assert.equal(instance.outputs.out.kind, 'texture');
	assert.deepEqual(instance.outputs.out.read(frame).texture.pixel, [0.5, 0, 0, 0.5]);
	instance.dispose();
});

// 【入れ子を跨いで使用出力を集約し、描画列を一度だけ決める】
// 子の未使用の公開入力が親の枝を描画したり、複数出力のために同じ配置の履歴を二度進めたりしない。
// 同じ登録済みグラフをもう一度配置した場合は、それぞれの出力要求・履歴を独立させる。
test('merges output demand per placement and prunes unused inputs across graph boundaries', async () => {
	const processor = definition('processor', ['source'], ['color', 'field', 'spare']);
	const combine = definition('combine', ['a', 'b'], ['result']);
	const unused = definition('unused', [], ['out']);
	const child = graph([globalIn, effectNode('main', native('processor'), { source: wire('in', 'visible') }),
		globalOut({ left: connection('main', 'color'), right: connection('main', 'field'), dead: connection('in', 'hidden') })],
	['visible', 'hidden'], ['left', 'right', 'dead']);
	const childPlacement = id => effectNode(id, { type: 'customNodeGraphEffectReference', id: 'child' },
		{ visible: wire('in', 'source'), hidden: wire('matcher', 'out') });
	const parent = graph([globalIn, effectNode('matcher', native('unused')), childPlacement('first'), childPlacement('second'),
		effectNode('mix', native('combine'), { a: wire('first', 'left'), b: wire('first', 'right') }),
		globalOut({ result: connection('mix', 'result'), other: connection('second', 'right') })], ['source'], ['result', 'other']);
	const textureResolution = { width: 320, height: 200 };
	const input = { kind: 'texture', resolution: textureResolution, sampling, read: frame => ({ kind: 'texture', texture: frame.texture }) };
	const created = [];
	const draws = [];
	const disposed = [];
	const effectEnvironment = environment([processor, combine, unused], [['child', child]]);
	const instance = await createCustomNodeGraphEffectInstance(parent, options({ source: input }, ['result', 'other']), effectEnvironment,
		(effect, placement) => {
			const index = created.length;
			created.push({ id: effect.definition.id, ports: [...placement.usedOutputPorts], resolution: placement.resolution });
			const outputs = Object.fromEntries([...placement.usedOutputPorts].map(port => [port, {
				kind: 'texture', resolution: placement.resolution, read: () => ({ kind: 'texture', texture: { index, port } }),
			}]));
			return { outputs, render(frame) {
				draws.push([index, ...Object.values(placement.inputs).map(input => input.read(frame).texture)]);
			}, dispose() { disposed.push(index); } };
		});
	assert.deepEqual(created, [
		{ id: 'processor', ports: ['color', 'field'], resolution: textureResolution },
		{ id: 'combine', ports: ['result'], resolution: textureResolution },
		{ id: 'processor', ports: ['field'], resolution: textureResolution },
	]);
	// 参照解決も配線の探索も初期化だけで済み、実行中は借用テクスチャの差し替えを受け取れる。
	effectEnvironment.catalog.nativeEffects.clear();
	effectEnvironment.catalog.customNodeGraphEffects.clear();
	instance.render({ texture: 'frame 1' });
	instance.render({ texture: 'frame 2' });
	assert.deepEqual(draws, [[0, 'frame 1'], [1, { index: 0, port: 'color' }, { index: 0, port: 'field' }], [2, 'frame 1'],
		[0, 'frame 2'], [1, { index: 0, port: 'color' }, { index: 0, port: 'field' }], [2, 'frame 2']]);
	assert.deepEqual(instance.outputs.other.read({}).texture, { index: 2, port: 'field' });
	instance.dispose();
	instance.dispose();
	assert.deepEqual(disposed, [2, 1, 0]);
});

// 【公開入力・Relay・バイパスは値を転送し、入力の種類と寸法を保つ】
// インラインの子グラフから外へ戻っても、定数や入力画像を描画対象にしたり、
// 未接続の出力に仮の画像を割り当てたりしないことを確認する。
test('forwards borrowed texture and uniform outputs through inline, relay and bypass without creating leaves', async () => {
	const bypass = { ...effectNode('bypass', native('processor'), { source: wire('relay', 'output') }), isBypass: true };
	const child = graph([globalIn, { id: 'relay', type: 'relay', input: connection('in', 'source'), dataType: { kind: 'color' } }, bypass,
		globalOut({ result: connection('bypass', 'color'), empty: connection(null, null) })], ['source'], ['result', 'empty']);
	const parent = graph([globalIn, effectNode('nested', { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: child }, { source: wire('in', 'source') }),
		globalOut({ result: connection('nested', 'result'), empty: connection('nested', 'empty') })], ['source'], ['result', 'empty']);
	const effectEnvironment = environment([definition('processor', ['source'], ['color'])]);
	for (const input of [
		{ kind: 'uniform', sampling, read: frame => ({ kind: 'uniform', value: [frame.time] }) },
		{ kind: 'texture', resolution: { width: 88, height: 60 }, sampling, read: frame => ({ kind: 'texture', texture: frame.texture }) },
	]) {
		const instance = await createCustomNodeGraphEffectInstance(parent, options({ source: input }, ['result', 'empty']),
			effectEnvironment, () => assert.fail('Passthrough created a leaf'));
		const frame = { time: 3, texture: {} };
		instance.render(frame);
		assert.deepEqual(Object.keys(instance.outputs), ['result']);
		assert.equal(instance.outputs.result.kind, input.kind);
		assert.equal(instance.outputs.result.resolution, input.resolution);
		assert.deepEqual(instance.outputs.result.read(frame), input.read(frame));
		instance.dispose();
	}
});

// 【入れ子の公開CPU値をCustom Shader Effectのuniform入力へ渡す】
// 外側の時変パラメータを参照する場合も、シェーダー生成時にはuniformであることが確定する。
// 後続フレームは同じ配置で値だけを評価し直す。
test('binds a changing public CPU parameter to a fixed shader uniform across graph scopes', async () => {
	const gain = { id: 'gain', nameForReference: 'gain', dataType: { kind: 'scalar' }, canNode: false,
		ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 1 } };
	const reference = { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'gain' };
	const shader = { kind: 'generate', primaryInputId: null, primaryOutputId: null, resolutionInputIds: ['factor'],
		shaderApiVersion: 1, codeLanguage: 'wgsl', code: '', paramDefs: [{ ...gain, canNode: true, id: 'factor' }],
		outputDefs: [{ id: 'out', nameForReference: 'out', label: 'Out', dataType: { kind: 'scalar' } }] };
	const child = { ...graph([effectNode('shader', { type: 'inlineCustomShaderEffect', customShaderEffect: shader }, { factor: reference }),
		globalOut({ result: connection('shader', 'out') })], [], ['result']), paramDefs: [gain] };
	const parent = { ...graph([effectNode('nested', { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: child }, { gain: reference }),
		globalOut({ result: connection('nested', 'result') })], [], ['result']), paramDefs: [gain] };
	const instance = await createCustomNodeGraphEffectInstance(parent, options({ gain: { kind: 'value', read: frame => frame.time * 2 } }, ['result']),
		environment([]), (effect, placement) => {
			assert.equal(effect.type, 'customShaderEffect');
			assert.equal(placement.inputs.factor.kind, 'uniform');
			assert.deepEqual(placement.resolution, contextResolution);
			return drawUniformToTexture(placement.inputs.factor, placement.resolution, 'out');
		});
	for (const time of [1, 3, 5]) {
		const frame = { time };
		instance.render(frame);
		assert.deepEqual(instance.outputs.result.read(frame).texture.pixel, [time * 2]);
	}
	instance.dispose();
});

// 【PUBLICはCPUだけの配列を読み、GPU入力を含み得る配列を要求しない】
// 式が参照し得る公開値を準備するときも、GPU側の未使用の枝を実行計画へ追加しない。
test('reads a CPU container from expressions without tracing a public container of images', async () => {
	const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Factor', control: { controlType: 'number' } }, canNode: true,
		defaultValue: { inputSource: 'literal', value: 0 } };
	const array = (id, canNode) => ({ id, nameForReference: id, canNode: false, dataType: { kind: 'array', elementType: scalar.dataType },
		element: { defaultValue: scalar.defaultValue, canNode }, ui: { label: id, control: { element: scalar.ui.control } },
		defaultValue: { inputSource: 'literal', value: [] } });
	const element = binding => ({ inputSource: 'literal', value: [{ id: 'element', binding }] });
	const child = { ...graph([effectNode('read', native('read'), { factor: { inputSource: 'expression', expression: 'series' } }),
		globalOut({ result: connection('read', 'out') })], [], ['result']), paramDefs: [array('series', false), array('images', true)] };
	const parent = graph([effectNode('unused', native('unused')), effectNode('nested', { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: child },
		{ series: element({ inputSource: 'envVariable', variable: 'TIME' }), images: element(wire('unused', 'out')) }),
	globalOut({ result: connection('nested', 'result') })], [], ['result']);
	const effectEnvironment = environment([{ ...definition('read', [], ['out']), paramDefs: { factor: scalar } }, definition('unused', [], ['out'])]);
	effectEnvironment.expressionEngine = { evaluate: (code, { functions }) => functions.PUBLIC(code)[0] };
	const instance = await createCustomNodeGraphEffectInstance(parent, options({}, ['result']), effectEnvironment, (effect, placement) => {
		assert.equal(effect.definition.id, 'read');
		return drawUniformToTexture(placement.inputs.factor, placement.resolution, 'out');
	});
	for (const time of [1, 2]) {
		const frame = { time, endTime: 10, isExport: false };
		instance.render(frame);
		assert.deepEqual(instance.outputs.result.read(frame).texture.pixel, [time]);
	}
	instance.dispose();
});

// 【自動解像度を決めた後、同じノードのuniform式でその寸法を使う】
// 入力の種類の計画にuniformのフレーム値を要求すると、RESOLUTIONを読む式が自身の解像度計算へ再入する。
// 入力画像で決定した寸法と各フレームの時刻が、同じ初期化済みの配置から正しく読めることを確かめる。
test('resolves automatic dimensions before evaluating an input expression', async () => {
	const processor = definition('process', ['image', 'tint'], ['value']);
	const effectGraph = graph([globalIn, effectNode('process', native('process'), {
		image: wire('in', 'image'), tint: { inputSource: 'expression', expression: 'dimensions' },
	}), globalOut({ result: connection('process', 'value') })], ['image'], ['result']);
	const env = environment([processor]);
	let evaluations = 0;
	env.expressionEngine = { evaluate(_code, { variables }) {
		evaluations++;
		return [...variables.RESOLUTION, variables.TIME, 1];
	} };
	const image = { kind: 'texture', resolution: { width: 32, height: 48 }, sampling, read: () => { throw new Error('Unexpected texture read'); } };
	const instance = await createCustomNodeGraphEffectInstance(effectGraph, options({ image }, ['result']), env, (_effect, placement) => {
		assert.deepEqual(placement.resolution, image.resolution);
		return drawUniformToTexture(placement.inputs.tint, placement.resolution, 'value');
	});
	assert.equal(evaluations, 0);
	for (const time of [1, 2]) {
		const frame = { time, endTime: 10, isExport: false };
		instance.render(frame);
		assert.deepEqual(instance.outputs.result.read(frame).texture.pixel, [32, 48, time, 1]);
	}
	assert.equal(evaluations, 2);
	instance.dispose();
});

// 【途中の配置で初期化に失敗したら、生成済みの配置を逆順に破棄する】
// 非同期のシェーダーコンパイル等が失敗しても、すでに作成した上流のGPU資源をリークしない。
test('releases the initialized prefix when a later leaf fails', async () => {
	const definitionA = definition('stage', ['source'], ['out']);
	const pipeline = graph([globalIn, effectNode('a', native('stage'), { source: wire('in', 'source') }),
		effectNode('b', native('stage'), { source: wire('a', 'out') }), effectNode('c', native('stage'), { source: wire('b', 'out') }),
		globalOut({ final: connection('c', 'out') })], ['source'], ['final']);
	const input = { kind: 'texture', resolution: contextResolution, read: () => ({ kind: 'texture', texture: {} }), sampling };
	let created = 0;
	const disposed = [];
	await assert.rejects(createCustomNodeGraphEffectInstance(pipeline, options({ source: input }, ['final']), environment([definitionA]), async () => {
		const index = created++;
		if (index === 2) throw new Error('compile failure');
		return { outputs: { out: input }, render() {}, dispose() { disposed.push(index); } };
	}), /compile failure/);
	assert.deepEqual(disposed, [1, 0]);
});
