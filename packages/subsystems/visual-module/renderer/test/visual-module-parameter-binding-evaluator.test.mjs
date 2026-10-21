import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/visual-module-parameter-binding-evaluator.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { VisualModuleParameterBindingEvaluator } = module.exports;
const expression = expression => ({ inputSource: 'expression', expression });
const scalarDefinition = { dataType: { kind: 'scalar' }, ui: { label: 'Value' } };
const vectorDefinition = { dataType: { kind: 'vector' }, ui: { label: 'Value' } };
const colorDefinition = { dataType: { kind: 'color' }, ui: { label: 'Value' } };
const context = (overrides = {}) => ({
	variables: {}, automationGraphs: [], time: 500, endTime: 5000,
	evaluatedParamValues: new Map(), paramIdsByName: new Map(), ...overrides,
});

// 【Visual Moduleの式でも共通の乱数・ノイズとPARAMを組み合わせる】
// Timeline専用の登録や別の乱数実装にせず、公開パラメータをseedとして使えるようにする。
// 評価器やASTを再利用してseedを変更しても、前回の系列を保持しないことを確認する。
test('combines shared random and noise functions with evaluated custom parameters', () => {
	const evaluator = new VisualModuleParameterBindingEvaluator();
	const binding = expression('[RANDOM(0, PARAM("seed")), NOISE(0.25, PARAM("seed"))]');
	const at = seed => evaluator.evaluate(binding, context({
		evaluatedParamValues: new Map([['seed-id', seed]]), paramIdsByName: new Map([['seed', 'seed-id']]),
	}), null, vectorDefinition);
	assert.deepEqual(at(0), [0.21822303580120206, -0.13380707257101676]);
	assert.notDeepEqual(at(1), at(0));
	assert.deepEqual(at(0), [0.21822303580120206, -0.13380707257101676]);
});

// 【接続参照はVisual Moduleの評価器が解決する】
// 共通の値評価器にはノードの識別子を持ち込まず、未接続の場合も従来のnullを返す。
test('evaluates node references directly', () => {
	const evaluator = new VisualModuleParameterBindingEvaluator();
	assert.deepEqual(evaluator.evaluate({ inputSource: 'node', nodeId: 'source', outputPort: 'value' }, context(), -1, scalarDefinition), { nodeId: 'source', outputPort: 'value' });
	assert.equal(evaluator.evaluate({ inputSource: 'node', nodeId: null }, context(), -1, scalarDefinition), null);
});

// 【PARAMの名前と直接参照のID】
// 評価済みの値と名前の対応を直接渡し、Visual Moduleの生成やレンダラーに依存しない。
test('resolves parameter names separately from IDs and rejects invalid expressions', () => {
	const evaluator = new VisualModuleParameterBindingEvaluator();
	const scope = context({ evaluatedParamValues: new Map([['gain-id', 0]]), paramIdsByName: new Map([['gain', 'gain-id']]) });
	assert.equal(evaluator.evaluate(expression('PARAM("gain")'), scope, -1, scalarDefinition), 0);
	assert.equal(evaluator.evaluate({ inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' }, scope, -1, scalarDefinition), 0);
	for (const text of ['PARAM("gain-id")', 'PARAM("missing")', 'PARAM(1)', 'PARAM()', 'PARAM("gain", 1)', '1 +', '']) {
		assert.throws(() => evaluator.evaluate(expression(text), scope, -1, scalarDefinition), /Base expression/);
	}
	for (const empty of [context(), context({ evaluatedParamValues: new Map(), paramIdsByName: scope.paramIdsByName })]) {
		assert.throws(() => evaluator.evaluate(expression('PARAM("gain")'), empty, -1, scalarDefinition), /Unknown or unavailable parameter/);
		assert.equal(evaluator.evaluate({ inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' }, empty, -1, scalarDefinition), -1);
	}
});

// 【参照値の複製】
// 評価結果の変更が、次回の評価で使うスコープや評価済みパラメータを破壊しない。
test('clones values read from variables and evaluated parameters', () => {
	const evaluator = new VisualModuleParameterBindingEvaluator();
	const value = [1, 0.5, 0, 0.25];
	const scope = context({ variables: { COLOR: value }, evaluatedParamValues: new Map([['color-id', value]]), paramIdsByName: new Map([['color', 'color-id']]) });
	for (const binding of [expression('COLOR'), { inputSource: 'envVariable', variable: 'COLOR' }, expression('PARAM("color")'), { inputSource: 'externalCustomParameterInput', parameterId: 'color-id' }]) {
		const result = evaluator.evaluate(binding, scope, null, colorDefinition);
		assert.deepEqual(result, value);
		result[0] = 99;
		assert.deepEqual(evaluator.evaluate(binding, scope, null, colorDefinition), [1, 0.5, 0, 0.25]);
	}
});

