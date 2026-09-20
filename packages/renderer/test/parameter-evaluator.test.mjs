import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 既存のnode:testでTSソースを実行する。WGSLやブラウザーの実行環境は不要。
async function loadSource(name) {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		write: false,
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const { ParameterEvaluator } = await loadSource('parameter-evaluator');

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const number = { dataType: 'scalar', ui: { control: 'number' } };
const node = (params, isBypass = false) => ({ id: 'node', type: 'effect', effectId: 'test', isBypass, params });
const paramDef = (id, defaultValue = 7, dataType = 'scalar') => ({ id, name: id, label: id, dataType, ui: { control: dataType === 'scalar' ? 'number' : dataType }, defaultValue, canNode: true, isPrimaryInput: false });
const context = (defs, params, overrides = {}) => ({
	nodes: [node(params)],
	paramDefs: [],
	effectDefinitions: { test: { paramDefs: defs } },
	automations: [],
	resolution: { width: 640, height: 360 },
	time: 500,
	progress: 0.25,
	paramValues: {},
	textureParamIds: new Set(),
	...overrides,
});

// 単一の組み込み変数はモジュール・ネストしたノードのどちらでもパースも実行もしない
test('reads single scope variables without parsing or executing AiScript', t => {
	const evaluator = new ParameterEvaluator();
	const parse = t.mock.method(evaluator.aisParser, 'parse');
	// AiScriptのautobind getterを解決してから、実メソッドの呼び出しを記録する。
	void evaluator.aiscript.execSync;
	const exec = t.mock.method(evaluator.aiscript, 'execSync');
	const input = context({ values: { dataType: 'array', item: number } }, {
		values: literal(['TIME', 'TIME_MS', 'WIDTH', 'HEIGHT', 'PROGRESS'].map(name => expression(` \t${name}\r\n`))),
	}, { paramDefs: [paramDef('time')], paramValues: { time: expression('TIME') } });
	const first = evaluator.evaluate(input);
	assert.equal(first.paramValues.get('time'), 0.5);
	assert.deepEqual(first.nodeParams.get('node').values, [0.5, 500, 640, 360, 0.25]);
	const second = evaluator.evaluate({ ...input, time: 0, progress: 0, resolution: { width: 1280, height: 720 } });
	assert.equal(second.paramValues.get('time'), 0);
	assert.deepEqual(second.nodeParams.get('node').values, [0, 0, 1280, 720, 0]);
	assert.equal(parse.mock.callCount(), 0);
	assert.equal(exec.mock.callCount(), 0);
});

// automationの変数も直接取得し、同名の組み込み変数は組み込み側を優先する
test('reads automation variables directly while preserving built-in precedence', t => {
	const evaluator = new ParameterEvaluator();
	const parse = t.mock.method(evaluator.aisParser, 'parse');
	// AiScriptのautobind getterを解決してから、実メソッドの呼び出しを記録する。
	void evaluator.aiscript.execSync;
	const exec = t.mock.method(evaluator.aiscript, 'execSync');
	const automations = ['gain_1', 'channel:level', 'TIME'].map(name => ({ id: name, name, keyframes: [
		{ timeMs: 0, value: 8, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
		{ timeMs: 1000, value: 8, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
	] }));
	const result = evaluator.evaluate(context({ a: number, b: number, time: number }, {
		a: expression('gain_1'), b: expression('channel:level'), time: expression('TIME'),
	}, { automations }));
	assert.deepEqual(result.nodeParams.get('node'), { a: 8, b: 8, time: 0.5 });
	assert.equal(parse.mock.callCount(), 0);
	assert.equal(exec.mock.callCount(), 0);
});

// 複合式・コメント・関数呼び出し・未定義変数は従来のAiScript評価に渡す
test('uses AiScript for complex expressions and unknown variables', t => {
	const evaluator = new ParameterEvaluator();
	const parse = t.mock.method(evaluator.aisParser, 'parse');
	// AiScriptのautobind getterを解決してから、実メソッドの呼び出しを記録する。
	void evaluator.aiscript.execSync;
	const exec = t.mock.method(evaluator.aiscript, 'execSync');
	const expressions = ['TIME + 1', 'TIME // comment', 'PARAM("gain")', 'UNKNOWN', 'toString'];
	const result = evaluator.evaluate(context({ values: { dataType: 'array', item: number } }, {
		values: literal(expressions.map(expression)),
	}, { paramDefs: [paramDef('gain', 4)] }));
	assert.deepEqual(result.nodeParams.get('node').values, [1.5, 0.5, 4, 0, 0]);
	assert.equal(parse.mock.callCount(), expressions.length);
	assert.equal(exec.mock.callCount(), expressions.length);
});

// 同名のautomationがあってもtrue・false・nullを変数として扱わない
test('preserves literal and keyword semantics when automation names collide', t => {
	const evaluator = new ParameterEvaluator();
	const parse = t.mock.method(evaluator.aisParser, 'parse');
	const names = ['true', 'false', 'null', 'if'];
	const result = evaluator.evaluate(context({ values: { dataType: 'array', item: number } }, {
		values: literal(names.map(expression)),
	}, { automations: names.map(name => ({ id: name, name, keyframes: [
		{ timeMs: 0, value: 99 }, { timeMs: 1000, value: 99 },
	] })), time: 0 }));
	assert.deepEqual(result.nodeParams.get('node').values, [true, false, null, 0]);
	assert.equal(parse.mock.callCount(), names.length);
});

// GPUなしでネストした値・式・接続参照を評価する
test('evaluates nested values, expressions and node references without a GPU', () => {
	const input = context({
		items: { dataType: 'array', item: { dataType: 'struct', fields: { value: number } } },
		link: { ...number, canNode: true },
		empty: { dataType: 'array', item: number },
	}, {
		items: literal([literal({ value: expression('WIDTH + HEIGHT + TIME + TIME_MS + PROGRESS') }), literal({ value: literal(9) })]),
		link: { inputSource: 'node', nodeId: 'source', outputPort: 'value' },
		empty: literal([]),
	});
	const result = new ParameterEvaluator().evaluate(input);
	assert.deepEqual(result.nodeParams.get('node'), {
		items: [{ value: 1500.75 }, { value: 9 }],
		link: { nodeId: 'source', outputPort: 'value' },
		empty: [],
	});
});

// モジュールの既定値・式・マクロ・PARAMを同じ評価結果に解決する
test('resolves module values before externalParameterInputs and PARAM expressions', () => {
	const result = new ParameterEvaluator().evaluate(context({ a: number, b: number, c: number }, {
		a: { inputSource: 'externalParameterInput', parameterId: 'gain' },
		b: expression('PARAM("gain") + PARAM("offset")'),
		c: expression('PARAM("literal")'),
	}, {
		paramDefs: [paramDef('gain'), paramDef('offset', 3), paramDef('literal')],
		paramValues: { gain: expression('TIME * 4'), literal: literal(11) },
	}));
	assert.deepEqual(result.nodeParams.get('node'), { a: 2, b: 5, c: 11 });
	assert.equal(result.paramValues.get('offset'), 3);
});

// テクスチャのパラメータや不正な式は値として参照せずフォールバックする
test('falls back for texture parameters, missing references and invalid expressions', () => {
	const params = {
		textureExternalParameterInput: { inputSource: 'externalParameterInput', parameterId: 'texture' },
		textureExpression: expression('PARAM("texture")'),
		missing: expression('PARAM("missing")'),
		invalid: expression('1 +'),
		empty: expression(''),
		missingExternalParameterInput: { inputSource: 'externalParameterInput', parameterId: 'missing' },
		missingAutomation: { inputSource: 'automation', automationId: 'missing' },
	};
	const result = new ParameterEvaluator().evaluate(context(Object.fromEntries(Object.keys(params).map(key => [key, number])), params, {
		paramDefs: [paramDef('texture', 99), paramDef('missingAutomation', 12)],
		paramValues: { missingAutomation: { inputSource: 'automation', automationId: 'missing' } },
		textureParamIds: new Set(['texture']),
	}));
	assert.deepEqual(result.nodeParams.get('node'), Object.fromEntries(Object.keys(params).map(key => [key, 0])));
	assert.equal(result.paramValues.has('texture'), false);
	assert.equal(result.paramValues.get('missingAutomation'), 12);
});

// automationを直接入力・式・モジュールパラメータから同じ時刻で評価する
test('evaluates automation inputs and expression scope at the supplied time', () => {
	const evaluator = new ParameterEvaluator();
	const input = context({ direct: number, scoped: number, externalParameterInput: number }, {
		direct: { inputSource: 'automation', automationId: 'ramp' },
		scoped: expression('RAMP'),
		externalParameterInput: { inputSource: 'externalParameterInput', parameterId: 'value' },
	}, {
		paramDefs: [paramDef('value')],
		paramValues: { value: { inputSource: 'automation', automationId: 'ramp' } },
		automations: [{ id: 'ramp', name: 'RAMP', keyframes: [
			{ timeMs: 0, value: 0, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
			{ timeMs: 1000, value: 10, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
		] }],
	});
	assert.deepEqual(evaluator.evaluate(input).nodeParams.get('node'), { direct: 5, scoped: 5, externalParameterInput: 5 });
	assert.deepEqual(evaluator.evaluate({ ...input, time: 0 }).nodeParams.get('node'), { direct: 0, scoped: 0, externalParameterInput: 0 });
});

// バイパス中は主入力以外の不正なコンテナも評価しない
test('evaluates only the primary parameter when bypassed', () => {
	const params = { main: literal(4), unused: expression('invalid container') };
	const input = context({ main: { ...number, primary: true }, unused: { dataType: 'array', item: number } }, params, { nodes: [node(params, true)] });
	assert.deepEqual(new ParameterEvaluator().evaluate(input).nodeParams.get('node'), { main: 4 });
});

// 次回評価で前回の結果を書き換えず、既定値の配列を共有しない
test('keeps previous results and clones module defaults between evaluations', () => {
	const evaluator = new ParameterEvaluator();
	const def = paramDef('color', [1, 0.5, 0, 0.25], 'color');
	const input = context({ value: number }, { value: expression('TIME') }, { paramDefs: [def] });
	const first = evaluator.evaluate(input);
	first.paramValues.get('color')[0] = 0;
	const second = evaluator.evaluate({ ...input, time: 2000 });
	assert.equal(first.nodeParams.get('node').value, 0.5);
	assert.equal(second.nodeParams.get('node').value, 2);
	assert.deepEqual(second.paramValues.get('color'), [1, 0.5, 0, 0.25]);
	assert.deepEqual(def.defaultValue, [1, 0.5, 0, 0.25]);
	assert.equal(evaluator.evaluate({ ...input, nodes: [] }).nodeParams.size, 0);
});

// UIの範囲やコントロールの種類は式・外部パラメータ・接続の数値型に影響しない。
test('evaluates numeric parameters independently of their UI controls', async () => {
	const { getNodeInputDataType } = await loadSource('../../shared/src/utility/node-outputs');
	const evaluator = new ParameterEvaluator();
	for (const ui of [{ control: 'number' }, { control: 'range', min: 10, max: 20, step: 1 }, { control: 'seed' }, { control: 'angle' }]) {
		const def = { ...number, ui, canNode: true };
		const external = { ...paramDef('amount'), ui };
		const result = evaluator.evaluate(context({ amount: def, external: def, invalid: def }, {
			amount: expression('TIME + 100'),
			external: { inputSource: 'externalParameterInput', parameterId: 'amount' },
			invalid: expression('missing'),
		}, { paramDefs: [external], paramValues: { amount: literal(-5.25) } }));
		assert.deepEqual(result.nodeParams.get('node'), { amount: 100.5, external: -5.25, invalid: 0 });
		assert.equal(getNodeInputDataType(def), 'scalar');
	}
});

// 数値の型名を入出力で揃え、参照や真偽値からのテクスチャ変換も維持する。
test('uses shared scalar types for node inputs and module outputs', async () => {
	const { getNodeInputDataType, getNodeOutputs, areNodeDataTypesCompatible } = await loadSource('../../shared/src/utility/node-outputs');
	const defs = [paramDef('amount'), paramDef('flag', true, 'bool'), paramDef('image', null, 'assetReference')];
	const outputs = getNodeOutputs({ id: 'in', type: 'globalIn' }, defs);
	assert.equal(outputs.amount.dataType, 'scalar');
	assert.equal(outputs.flag.dataType, 'scalar');
	assert.equal(outputs.image.dataType, 'color');
	assert.equal(getNodeInputDataType({ ...number, canNode: false }), null);
	assert.equal(getNodeInputDataType({ dataType: 'playerReference', canNode: true }), null);
	assert.equal(areNodeDataTypesCompatible(outputs.amount.dataType, getNodeInputDataType({ ...number, canNode: true })), true);
	assert.equal(areNodeDataTypesCompatible('scalar', 'vector'), false);
	assert.equal(areNodeDataTypesCompatible('any', 'scalar'), true);
});

for (const enable32bitDataTextures of [false, true]) {
	// 評価結果を指定精度で書き込み、prepare後は再評価せず、次フレームでは更新する
	test(`uploads evaluated parameters and reuses preparation with ${enable32bitDataTextures ? 32 : 16}-bit textures`, async t => {
		const originalUsage = Object.getOwnPropertyDescriptor(globalThis, 'GPUTextureUsage');
		const originalQueue = Object.getOwnPropertyDescriptor(globalThis, 'GPUQueue');
		globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16, COPY_DST: 2 };
		globalThis.GPUQueue = class { submit() {} };
		t.after(() => {
			if (originalUsage) Object.defineProperty(globalThis, 'GPUTextureUsage', originalUsage);
			else delete globalThis.GPUTextureUsage;
			if (originalQueue) Object.defineProperty(globalThis, 'GPUQueue', originalQueue);
			else delete globalThis.GPUQueue;
		});
		const { VisualModuleRenderer } = await loadSource('visual-module-renderer');
		const writes = [];
		const renderedValues = [];
		const createTexture = (descriptor = {}) => ({ ...descriptor, createView: () => ({}), destroy() {} });
		const device = {
			createTexture,
			queue: { writeTexture({ texture }, data, layout) {
				texture.data = Array.from(data);
				writes.push({ texture, data: data.slice(), layout });
			} },
		};
		const definitions = { test: {
			paramDefs: { group: { dataType: 'struct', fields: {
				amount: { ...number, canNode: true },
				vector: { dataType: 'vector', ui: { control: 'vector' }, canNode: true },
				color: { dataType: 'color', ui: { control: 'color' }, canNode: true },
			} } },
			outputs: { image: { dataType: 'color', primary: true } },
		} };
		const output = createTexture();
		const renderer = new VisualModuleRenderer({
			gpuDevice: device, gpuContext: {}, defaultVertexShaderModule: {}, timingHelper: {},
			enableStats: false, enable32bitDataTextures, intermediateTextureFormat: 'rgba8unorm',
			resolution: { width: 16, height: 16 }, fallbackTexture: createTexture(), fallbackScalarFieldTexture: createTexture(),
			videoFrames: new Map(), videoFrameVersions: new Map(), assetTextures: new Map(), audioSources: new Map(), assets: [], automations: [],
			effectDefinitions: definitions,
			effectImplementations: { test: {
				outputTextureFactories: { image: () => output },
				init: () => ({ render: ({ params }) => renderedValues.push(params.group.amount.data[0]), dispose() {} }),
			} },
			visualModule: {
				id: 'module', name: 'Test', paramDefs: [],
				outputDefs: [{ id: 'out', isPrimaryOutput: true }],
				nodes: [node({ group: literal({ amount: expression('TIME + 1'), vector: literal([0.5, -1]), color: literal([1, 0.5, 0, 0.25]) }) }),
					{ id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'node', outputPort: 'image' } } }],
			},
		});
		t.after(() => renderer.destroy());
		const frame = { time: 500, timeDelta: 0, paramValues: {}, pointerPosition: { x: 0, y: 0 }, pointerPositionPrev: { x: 0, y: 0 } };
		await renderer.prepare(frame, new AbortController().signal);
		assert.equal(writes.length, 3);
		assert.deepEqual(renderedValues, []);
		assert.deepEqual(writes.map(write => write.texture.format), enable32bitDataTextures
			? ['r32float', 'rg32float', 'rgba32float'] : ['r16float', 'rg16float', 'rgba16float']);
		assert.deepEqual(writes.map(write => Array.from(write.data)), enable32bitDataTextures
			? [[1.5], [0.5, -1], [1, 0.5, 0, 0.25]] : [[0x3e00], [0x3800, 0xbc00], [0x3c00, 0x3800, 0, 0x3400]]);
		assert.deepEqual(writes.map(write => write.layout.bytesPerRow), enable32bitDataTextures ? [4, 8, 16] : [2, 4, 8]);
		assert.strictEqual(renderer.render(frame, {}), output);
		assert.equal(writes.length, 3);
		assert.deepEqual(renderedValues, [enable32bitDataTextures ? 1.5 : 0x3e00]);
		renderer.render({ ...frame, time: 1500 }, {});
		assert.equal(writes.length, 6);
		assert.deepEqual(renderedValues, enable32bitDataTextures ? [1.5, 2.5] : [0x3e00, 0x4100]);
		renderer.render({ ...frame, time: 1500 }, {});
		assert.equal(renderedValues.length, 2);
	});
}
