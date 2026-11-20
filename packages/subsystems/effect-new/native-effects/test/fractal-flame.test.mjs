import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packFlameTransforms, planFlameSampling, MAXIMUM_PLOTTED_SAMPLES, FIXED_POINT_SCALE } from '../src/fx/fractalFlame/flame-settings.ts';

const transform = (overrides = {}) => ({
	weight: 1, position: [0, 0], rotation: 0, scale: [1, 1], shear: 0, colorPosition: 0.5,
	variations: { linear: 1, sinusoidal: 0, spherical: 0, swirl: 0, horseshoe: 0, polar: 0, handkerchief: 0, heart: 0 },
	...overrides,
});

// 【共通単位の移動と時計回りのアフィン変換をGPUへ渡す】
// 異方的な拡縮・shear・回転をまとめた既知の行列で、適用順序と空間単位の変換漏れを検出する。
test('packs affine transforms with spatial translations and clockwise rotation', () => {
	const packed = packFlameTransforms([transform({ position: [0.125, -0.25], scale: [2, 3], shear: 0.5, rotation: 0.25 })]);
	const values = packed.values;
	assert.equal(packed.count, 1);
	assert.ok(Math.abs(values[0]) < 1e-6);
	assert.equal(values[1], 3);
	assert.equal(values[2], 0.5);
	assert.equal(values[4], -2);
	assert.equal(values[5], -1.5);
	assert.equal(values[6], -1);
	assert.equal(values[3], 1);
});

// 【変換の選択確率とvariationの混合係数を混同しない】
// 無効な変換を除外して選択確率だけを正規化し、非線形変換の符号付き係数はそのまま保つ。
// 重みの単純和がoverflowするような入力も、相対比率として安全に計算する。
test('normalizes transform probabilities and preserves signed variation coefficients', () => {
	const first = transform({ weight: 2, variations: { ...transform().variations, linear: -0.2, swirl: 1.4 } });
	const packed = packFlameTransforms([transform({ weight: 0 }), first, transform({ weight: 6 })]);
	assert.equal(packed.count, 2);
	assert.equal(packed.values[3], 0.25);
	assert.equal(packed.values[19], 1);
	assert.equal(packed.values[8], Math.fround(-0.2));
	assert.equal(packed.values[11], Math.fround(1.4));
	assert.equal(packFlameTransforms([transform({ weight: 1e38 }), transform({ weight: 1e38 })]).values[3], 0.5);
	assert.equal(packFlameTransforms([]).count, 0);
	assert.equal(packFlameTransforms([transform({ weight: 0 })]).count, 0);
});

// 【非有限の軌道設定と、GPUへ転送できないアフィン係数を描画前に拒否する】
// 式の値がstorage bufferへInfinityを入れたり、負の確率で選択分布を壊したりしないようにする。
test('rejects invalid transforms before GPU allocation', () => {
	assert.throws(() => packFlameTransforms(Array.from({ length: 17 }, () => transform())), /at most 16/);
	assert.throws(() => packFlameTransforms([transform({ weight: -1 })]), /nonnegative/);
	assert.throws(() => packFlameTransforms([transform({ rotation: NaN })]), /finite/);
	assert.throws(() => packFlameTransforms([transform({ scale: [1e38, 1e38], shear: 1e38 })]), /affine coefficients/);
});

// 【対称コピーを含む総点数から整数集計の上限を保証する】
// すべての点が1セルへ集中しても各チャンネルがu32に収まるようにし、上限超過を黙って欠落させない。
test('bounds plotted samples including rotational and mirror symmetry', () => {
	const maximum = planFlameSampling(4096, 2048, 64, 1, false);
	assert.equal(maximum.sampleCount, MAXIMUM_PLOTTED_SAMPLES);
	assert.ok(maximum.sampleCount * FIXED_POINT_SCALE < 2 ** 32);
	assert.equal(planFlameSampling(128, 64, 32, 3, true).sampleCount, 128 * 64 * 6);
	assert.throws(() => planFlameSampling(4096, 2048, 64, 2, false), /plotted samples/);
	assert.throws(() => planFlameSampling(1, Infinity, 0, 1, false), /finite/);
	assert.deepEqual(planFlameSampling(-1, 0, -5, 0, false), { orbitCount: 1, iterations: 1, burnIn: 0, symmetryOrder: 1, sampleCount: 1 });
});
