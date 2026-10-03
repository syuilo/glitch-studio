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
const context = (overrides = {}) => ({
	variables: {}, automationGraphs: [], time: 500, endTime: 5000,
	evaluatedParamValues: new Map(), paramIdsByName: new Map(), ...overrides,
});

// 【接続参照はVisual Moduleの評価器が解決する】
// 共通の値評価器にはノードの識別子を持ち込まず、未接続の場合も従来のnullを返す。
test('evaluates node references directly', () => {
	const evaluator = new VisualModuleParameterBindingEvaluator();
	assert.deepEqual(evaluator.evaluate({ inputSource: 'node', nodeId: 'source', outputPort: 'value' }, context(), -1), { nodeId: 'source', outputPort: 'value' });
	assert.equal(evaluator.evaluate({ inputSource: 'node', nodeId: null }, context(), -1), null);
});

// 【PARAMの名前と直接参照のID】
// 評価済みの値と名前の対応を直接渡し、Visual Moduleの生成やレンダラーに依存しない。
test('resolves parameter names separately from IDs and falls back for unavailable values', () => {
	const evaluator = new VisualModuleParameterBindingEvaluator();
	const scope = context({ evaluatedParamValues: new Map([['gain-id', 0]]), paramIdsByName: new Map([['Gain', 'gain-id']]) });
	assert.equal(evaluator.evaluate(expression('PARAM("Gain")'), scope, -1), 0);
	assert.equal(evaluator.evaluate({ inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' }, scope, -1), 0);
	for (const text of ['PARAM("gain-id")', 'PARAM("missing")', 'PARAM(1)', 'PARAM()', 'PARAM("Gain", 1)', '1 +', '']) {
		assert.equal(evaluator.evaluate(expression(text), scope, -1), -1);
	}
	for (const empty of [context(), context({ evaluatedParamValues: new Map(), paramIdsByName: scope.paramIdsByName })]) {
		assert.equal(evaluator.evaluate(expression('PARAM("Gain")'), empty, -1), -1);
		assert.equal(evaluator.evaluate({ inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' }, empty, -1), -1);
	}
});

// 【参照値の複製】
// 評価結果の変更が、次回の評価で使うスコープや評価済みパラメータを破壊しない。
test('clones values read from variables and evaluated parameters', () => {
	const evaluator = new VisualModuleParameterBindingEvaluator();
	const value = [1, 0.5, 0, 0.25];
	const scope = context({ variables: { COLOR: value }, evaluatedParamValues: new Map([['color-id', value]]), paramIdsByName: new Map([['Color', 'color-id']]) });
	for (const binding of [expression('COLOR'), { inputSource: 'envVariable', variable: 'COLOR' }, expression('PARAM("Color")'), { inputSource: 'externalCustomParameterInput', parameterId: 'color-id' }]) {
		const result = evaluator.evaluate(binding, scope, null);
		assert.deepEqual(result, value);
		result[0] = 99;
		assert.deepEqual(evaluator.evaluate(binding, scope, null), [1, 0.5, 0, 0.25]);
	}
});

