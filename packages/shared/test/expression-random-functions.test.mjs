import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadSource(name) {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
		bundle: true, platform: 'node', format: 'cjs', write: false,
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const [{ randomExpressionFunctions: { RANDOM, NOISE } }, { ParameterBindingEvaluator }] = await Promise.all([
	loadSource('expression/random-functions'), loadSource('parameter/parameter-binding-evaluator'),
]);
const expression = expression => ({ inputSource: 'expression', expression });
const scope = { variables: {}, automationGraphs: [], time: 0, endTime: Infinity };

// 【乱数とノイズのパターンを固定する】
// シークだけでなく、実装の整理によっても既存の式の動きが意図せず変わらないようにする。
// 負の値・32bitを超える値・安全な整数の端を含め、ハッシュと補間の参照値を残す。
test('preserves reference samples across the supported integer range', () => {
	for (const [index, seed, expected] of [
		[0, 0, 0.21822303580120206],
		[-7, -13, 0.07589363725855947],
		[4294967419, 17, 0.8156749648042023],
		[Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0.11229004920460284],
	]) assert.equal(RANDOM(index, seed), expected);
	for (const [coordinate, seed, expected] of [
		[0.25, 0, -0.13380707257101676],
		[-0.75, -13, -0.30678110046756046],
		[0.375, 4294967297, 0.6835680464617866],
		[2.125, Number.MIN_SAFE_INTEGER, 0.07036641551542289],
	]) assert.equal(NOISE(coordinate, seed), expected);
});

// 【省略seedと数値の範囲を保証する】
// 振幅や範囲を式の乗算で調整するため、RANDOMは1を含めず、NOISEは正負の値を返す必要がある。
// 連続した座標と負のseedも走査し、小数部や符号による範囲外の値を検出する。
test('defaults the seed to zero and keeps samples within their declared ranges', () => {
	const noiseValues = [];
	for (let index = -1000; index <= 1000; index++) {
		assert.equal(RANDOM(index), RANDOM(index, 0));
		assert.equal(NOISE(index / 16), NOISE(index / 16, 0));
		for (const seed of [Number.MIN_SAFE_INTEGER, -13, 0, 4294967297, Number.MAX_SAFE_INTEGER]) {
			const randomValue = RANDOM(index, seed);
			const noiseValue = NOISE(index / 16, seed);
			assert.ok(randomValue >= 0 && randomValue < 1);
			assert.ok(noiseValue >= -1 && noiseValue <= 1);
			noiseValues.push(noiseValue);
		}
	}
	assert.ok(noiseValues.some(value => value < -0.1));
	assert.ok(noiseValues.some(value => value > 0.1));
});

// 【座標・seedの上位bitと負数の符号を失わない】
// bit演算で32bitへ切り詰めたり短い置換テーブルを使ったりすると、
// 離れた時刻や異なるseedが常に同じパターンになってしまう。
test('distinguishes high integer bits and does not repeat at short lattice periods', () => {
	const indexes = [-4294967297, -1, 0, 1, 4294967297, Number.MAX_SAFE_INTEGER];
	assert.equal(new Set(indexes.map(index => RANDOM(index, 7))).size, indexes.length);
	assert.equal(new Set(indexes.map(seed => RANDOM(7, seed))).size, indexes.length);
	assert.equal(new Set(indexes.map(seed => NOISE(0.375, seed))).size, indexes.length);
	for (const offset of [256, 4294967296]) {
		assert.notEqual(RANDOM(19, 7), RANDOM(19 + offset, 7));
		assert.notEqual(NOISE(19.375, 7), NOISE(19.375 + offset, 7));
	}
});

// 【格子点でも勾配と加速度が滑らかにつながる】
// 値だけを連続にしても、区間ごとの停止や速度の飛びがあると揺れが不自然になる。
// 負の境界も含め、Perlin Noiseの格子点で値が0になり、勾配が左右で一致することを確認する。
test('keeps gradients continuous across positive and negative lattice boundaries', () => {
	const epsilon = 0.00001;
	for (const seed of [-13, 0, 7]) {
		for (const boundary of [-3, -1, 0, 1, 3]) {
			assert.equal(NOISE(boundary, seed), 0);
			const before = NOISE(boundary - epsilon, seed);
			const after = NOISE(boundary + epsilon, seed);
			const leftSlope = -before / epsilon;
			const rightSlope = after / epsilon;
			assert.ok(Math.abs(leftSlope - rightSlope) < 0.000001);
			assert.ok(Math.abs((before + after) / (epsilon * epsilon)) < 0.002);
		}
	}
	assert.ok(Math.abs(NOISE(epsilon, 7) / epsilon) > 0.01);
});

// 【有限の座標は整数の表現範囲の端でも受け付ける】
// NOISEの座標は安全な整数に限定しない。大きな数値は小数部を持てないため格子点として0を返し、
// 隣の格子点を無理に計算してNaNになったり、通常の式エラーへ落ちたりしないようにする。
test('accepts all finite coordinates including fractional and integer precision limits', () => {
	for (const coordinate of [-Number.MAX_VALUE, Number.MIN_SAFE_INTEGER, -0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
		assert.equal(NOISE(coordinate, 7), 0);
	}
	for (const coordinate of [-Number.MIN_VALUE, Number.MIN_VALUE, -4503599627370495.5, 4503599627370495.5]) {
		const value = NOISE(coordinate, 7);
		assert.ok(Number.isFinite(value) && value >= -1 && value <= 1);
	}
});

// 【状態・暗黙の時計・呼び出し位置に依存しない】
// ASTや評価器を再利用しても、往復シーク・別パラメータ・プレビューと書き出しで同じ値を得る。
// 同じ式内の同じ引数も同値とし、別の乱数呼び出しによって系列を進めない。
test('registers stateless functions without using scope time or call order', () => {
	const evaluator = new ParameterBindingEvaluator();
	const binding = expression('let first = RANDOM(-7, -13)\nRANDOM(100, 200)\n[first, RANDOM(-7, -13), NOISE(-0.75, -13)]');
	const expected = [0.07589363725855947, 0.07589363725855947, -0.30678110046756046];
	for (const time of [1000, -1000, 0, 5000, 1000]) {
		for (const isExport of [false, true]) {
			const context = { ...scope, time, variables: { TIME: time / 1000, IS_EXPORT: isExport } };
			assert.deepEqual(evaluator.evaluate(binding, context, null), expected);
			assert.deepEqual(new ParameterBindingEvaluator().evaluate(binding, context, null), expected);
		}
	}
	assert.deepEqual(evaluator.evaluate(expression('[RANDOM(7), RANDOM(7, 0), NOISE(0.25), NOISE(0.25, 0)]'), scope, null),
		[RANDOM(7), RANDOM(7), NOISE(0.25), NOISE(0.25)]);
});

// 【不正な引数は暗黙変換せず式のエラーとして伝播する】
// nullを省略seedとみなしたり、小数indexを丸めたりすると、式の誤りを見つけられない。
// AiScriptとの境界も通し、非有限値・安全でない整数・配列・余分な引数を一貫して拒否する。
test('throws expression errors for invalid arguments', () => {
	const evaluator = new ParameterBindingEvaluator();
	const invalidExpressions = [
		'RANDOM()', 'RANDOM(null)', 'RANDOM("1")', 'RANDOM(true)', 'RANDOM([1])', 'RANDOM(0.5)',
		'RANDOM(1, null)', 'RANDOM(1, "2")', 'RANDOM(1, 0.5)', 'RANDOM(1, 2, 3)',
		'NOISE()', 'NOISE(null)', 'NOISE("1")', 'NOISE(true)', 'NOISE([1])',
		'NOISE(1, null)', 'NOISE(1, "2")', 'NOISE(1, 0.5)', 'NOISE(1, 2, 3)',
	];
	for (const value of [NaN, -Infinity, Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
		const context = { ...scope, variables: { INVALID: value } };
		for (const text of ['RANDOM(INVALID)', 'RANDOM(1, INVALID)', 'NOISE(0.25, INVALID)']) {
			assert.throws(() => evaluator.evaluate(expression(text), context, 'invalid'), /Base expression/, `${text}: ${value}`);
		}
		if (!Number.isFinite(value)) assert.throws(() => evaluator.evaluate(expression('NOISE(INVALID)'), context, 'invalid'), /Base expression/);
	}
	for (const text of invalidExpressions) {
		assert.throws(() => evaluator.evaluate(expression(text), scope, 'invalid'), /Base expression/, text);
	}
});
