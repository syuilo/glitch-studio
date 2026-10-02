import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/easing.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { evaluateEasing } = module.exports;

const families = ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'];
const directions = ['in', 'out', 'inOut'];
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

// 【すべての系統と方向で端点とInOutの中点を正確に保つ】
// 指数・三角関数の端点誤差でキーの値がずれたり、InOutの接続部分で段差が生じたりしないようにする。
// 特にCircの平方根やBounceの区分境界でも、区間内の値が有限である必要がある。
test('preserves exact endpoints and in-out midpoints with finite values throughout every curve', () => {
	for (const family of families) {
		for (const direction of directions) {
			assert.equal(evaluateEasing(0, family, direction), 0);
			assert.equal(evaluateEasing(1, family, direction), 1);
			for (let i = 0; i <= 1000; i++) assert.ok(Number.isFinite(evaluateEasing(i / 1000, family, direction)), `${family} ${direction} ${i}`);
		}
		assert.equal(evaluateEasing(0.5, family, 'inOut'), 0.5);
		for (const progress of [0.5 - 1e-10, 0.5 + 1e-10]) {
			assert.ok(Math.abs(evaluateEasing(progress, family, 'inOut') - 0.5) < 1e-4);
		}
	}
});

// 【各系統の既知の中間値と方向変換】
// 方向別の式を重複させず、同じ基準曲線を反転・縮小して使う契約を固定する。
// 固定した期待値を使い、別の系統への取り違えやInOut固有の係数変更も検出する。
test('matches reference samples and derives all directions from the same family curve', () => {
	for (const [family, midpoint] of [
		['sine', 0.2928932188134524], ['quad', 0.25], ['cubic', 0.125],
		['quart', 0.0625], ['quint', 0.03125], ['expo', 0.03125],
		['circ', 0.1339745962155614], ['back', -0.0876975],
		['elastic', -0.015625], ['bounce', 0.234375],
	]) {
		closeTo(evaluateEasing(0.5, family, 'in'), midpoint);
		closeTo(evaluateEasing(0.5, family, 'out'), 1 - midpoint);
		closeTo(evaluateEasing(0.25, family, 'inOut'), midpoint / 2);
		closeTo(evaluateEasing(0.75, family, 'inOut'), 1 - midpoint / 2);
	}
	closeTo(evaluateEasing(0.25, 'quad', 'in'), 0.0625);
	closeTo(evaluateEasing(0.25, 'quad', 'out'), 0.4375);
	closeTo(evaluateEasing(0.25, 'expo', 'in'), 0.005524271728019903);
});

// 【BackとElasticのオーバーシュートを制限しない】
// 補間率を0〜1にクランプすると逆行や振動が消えてしまう。通常の系統には範囲外の値を持ち込まない。
test('retains back and elastic overshoot while keeping other families within the endpoint range', () => {
	for (const family of ['back', 'elastic']) {
		assert.ok(evaluateEasing(0.5, family, 'in') < 0);
		assert.ok(evaluateEasing(0.5, family, 'out') > 1);
		assert.ok(evaluateEasing(0.25, family, 'inOut') < 0);
		assert.ok(evaluateEasing(0.75, family, 'inOut') > 1);
	}
	for (const family of families.filter(family => family !== 'back' && family !== 'elastic')) {
		for (const direction of directions) {
			for (let i = 0; i <= 1000; i++) {
				const value = evaluateEasing(i / 1000, family, direction);
				assert.ok(value >= -1e-12 && value <= 1 + 1e-12, `${family} ${direction} ${i}`);
			}
		}
	}
});

// 【Bounceの接地点で連続性を維持する】
// 放物線の区分境界をまたぐシークで値が飛ばず、接地の合間には跳ね返る必要がある。
test('joins bounce segments continuously at each impact', () => {
	for (const impact of [4 / 11, 8 / 11, 10 / 11]) {
		closeTo(evaluateEasing(impact, 'bounce', 'out'), 1);
		assert.ok(Math.abs(evaluateEasing(impact - 1e-8, 'bounce', 'out') - 1) < 1e-6);
		assert.ok(Math.abs(evaluateEasing(impact + 1e-8, 'bounce', 'out') - 1) < 1e-6);
	}
	closeTo(evaluateEasing(6 / 11, 'bounce', 'out'), 0.75);
	closeTo(evaluateEasing(9 / 11, 'bounce', 'out'), 0.9375);
	closeTo(evaluateEasing(21 / 22, 'bounce', 'out'), 0.984375);
});
