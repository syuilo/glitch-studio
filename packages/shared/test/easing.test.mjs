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
			assert.equal(evaluateEasing(0, { family, direction }), 0);
			assert.equal(evaluateEasing(1, { family, direction }), 1);
			for (let i = 0; i <= 1000; i++) assert.ok(Number.isFinite(evaluateEasing(i / 1000, { family, direction })), `${family} ${direction} ${i}`);
		}
		assert.equal(evaluateEasing(0.5, { family, direction: 'inOut' }), 0.5);
		for (const progress of [0.5 - 1e-10, 0.5 + 1e-10]) {
			assert.ok(Math.abs(evaluateEasing(progress, { family, direction: 'inOut' }) - 0.5) < 1e-4);
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
		closeTo(evaluateEasing(0.5, { family, direction: 'in' }), midpoint);
		closeTo(evaluateEasing(0.5, { family, direction: 'out' }), 1 - midpoint);
		closeTo(evaluateEasing(0.25, { family, direction: 'inOut' }), midpoint / 2);
		closeTo(evaluateEasing(0.75, { family, direction: 'inOut' }), 1 - midpoint / 2);
	}
	closeTo(evaluateEasing(0.25, { family: 'quad', direction: 'in' }), 0.0625);
	closeTo(evaluateEasing(0.25, { family: 'quad', direction: 'out' }), 0.4375);
	closeTo(evaluateEasing(0.25, { family: 'expo', direction: 'in' }), 0.005524271728019903);
});

// 【BackとElasticのオーバーシュートを制限しない】
// 補間率を0〜1にクランプすると逆行や振動が消えてしまう。通常の系統には範囲外の値を持ち込まない。
test('retains back and elastic overshoot while keeping other families within the endpoint range', () => {
	for (const family of ['back', 'elastic']) {
		assert.ok(evaluateEasing(0.5, { family, direction: 'in' }) < 0);
		assert.ok(evaluateEasing(0.5, { family, direction: 'out' }) > 1);
		assert.ok(evaluateEasing(0.25, { family, direction: 'inOut' }) < 0);
		assert.ok(evaluateEasing(0.75, { family, direction: 'inOut' }) > 1);
	}
	for (const family of families.filter(family => family !== 'back' && family !== 'elastic')) {
		for (const direction of directions) {
			for (let i = 0; i <= 1000; i++) {
				const value = evaluateEasing(i / 1000, { family, direction });
				assert.ok(value >= -1e-12 && value <= 1 + 1e-12, `${family} ${direction} ${i}`);
			}
		}
	}
});

// 【Bounceの接地点で連続性を維持する】
// 放物線の区分境界をまたぐシークで値が飛ばず、接地の合間には跳ね返る必要がある。
test('joins bounce segments continuously at each impact', () => {
	for (const impact of [4 / 11, 8 / 11, 10 / 11]) {
		closeTo(evaluateEasing(impact, { family: 'bounce', direction: 'out' }), 1);
		assert.ok(Math.abs(evaluateEasing(impact - 1e-8, { family: 'bounce', direction: 'out' }) - 1) < 1e-6);
		assert.ok(Math.abs(evaluateEasing(impact + 1e-8, { family: 'bounce', direction: 'out' }) - 1) < 1e-6);
	}
	closeTo(evaluateEasing(6 / 11, { family: 'bounce', direction: 'out' }), 0.75);
	closeTo(evaluateEasing(9 / 11, { family: 'bounce', direction: 'out' }), 0.9375);
	closeTo(evaluateEasing(21 / 22, { family: 'bounce', direction: 'out' }), 0.984375);
});

// 【Backの係数でオーバーシュートを変える】
// 0でも既定値へ戻さず、折り返しと縮小は他の方向と同じ規約を使う。
test('applies custom Back coefficients while retaining the original default', () => {
	for (const direction of directions) {
		const settings = { family: 'back', direction };
		for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
			closeTo(evaluateEasing(progress, settings), evaluateEasing(progress, { ...settings, overshootCoefficient: 1.70158 }));
			closeTo(evaluateEasing(progress, { ...settings, overshootCoefficient: 0 }), evaluateEasing(progress, { family: 'cubic', direction }));
		}
	}
	closeTo(evaluateEasing(0.5, { family: 'back', direction: 'out', overshootCoefficient: 4 }), 1.375);
});

// 【Elasticの周期を基準カーブ上の長さとして調整する】
// 非既定の周期でも終点の位相を揃え、InOutの前半では基準カーブを半分に縮める。
test('applies Elastic periods with a fixed endpoint phase and half-period in InOut', () => {
	const settings = { family: 'elastic', direction: 'in', period: 0.5 };
	const amplitude = 2 ** -2.5;
	closeTo(evaluateEasing(0.75, settings), -amplitude);
	closeTo(evaluateEasing(0.75, { ...settings, period: 0.25 }), amplitude);
	closeTo(evaluateEasing(0.375, { ...settings, direction: 'inOut' }), -amplitude / 2);
	for (const direction of directions) {
		for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
			closeTo(evaluateEasing(progress, { family: 'elastic', direction, period: null }), evaluateEasing(progress, { family: 'elastic', direction, period: 0.3 }));
		}
		for (const period of [0.7, Number.MIN_VALUE]) {
			const custom = { family: 'elastic', direction, period };
			assert.equal(evaluateEasing(0, custom), 0);
			assert.equal(evaluateEasing(1, custom), 1);
			assert.ok(Number.isFinite(evaluateEasing(0.2, custom)));
		}
	}
});
