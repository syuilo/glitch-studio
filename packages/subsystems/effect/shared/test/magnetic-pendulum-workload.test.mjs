import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMagneticPendulumMaximumSteps, getMagneticPendulumRenderWorkloadHint } from '../src/fx/magneticPendulum/render-workload.ts';

const uniform = value => ({ kind: 'uniform', value });
const parameters = () => ({
	magnets: [{ position: [0, 0.25], height: 0.08, strength: 1, color: uniform([1, 0, 0, 1]), value: 0.1 }],
	damping: uniform(0.14), restoringStrength: uniform(1), initialVelocity: [0, 0], view: { center: [0, 0], zoom: 1 },
	timeStep: 0.06, maximumSteps: 1024, captureRadius: 0.05, captureSpeed: 0.045, antialiasing: false,
	settlingShading: 0, unconvergedColor: uniform([0, 0, 0, 1]), unconvergedValue: 0,
});
const hint = (params, ports = ['output']) => getMagneticPendulumRenderWorkloadHint({ params, usedOutputPorts: new Set(ports) });

// 【最大ステップ数とAAの増加を、描画前の安全な面積縮小へ反映する】
// UI範囲外の値や小数が入っても、シェーダーの実際の反復上限と計算量ヒントを一致させる。
test('scales magnetic pendulum work with shader steps, magnets and antialiasing', () => {
	const params = parameters();
	const original = hint(params);
	assert.equal(original.workPerPixel, 1024);
	const heavier = hint({ ...params, maximumSteps: 2048, antialiasing: true });
	assert.equal(heavier.key, original.key);
	assert.equal(heavier.workPerPixel, original.workPerPixel * 8);
	assert.equal(hint({ ...params, magnets: [...params.magnets, ...params.magnets] }).workPerPixel, 2048);
	for (const [input, expected] of [[0, 1], [1.9, 1], [1024.9, 1024], [9999, 2048]]) {
		assert.equal(getMagneticPendulumMaximumSteps(input), expected);
		assert.equal(hint({ ...params, maximumSteps: input }).workPerPixel, expected);
	}
	assert.ok(hint({ ...params, magnets: [] }).workPerPixel > 0);
});

// 【視点・収束条件・出力構成が変われば、以前の軽い領域の学習を無効化する】
// 色だけの変更は積分量を変えないため、物理条件と独立して学習を維持できる。
test('identifies physical conditions while retaining learning for color changes', () => {
	const params = parameters();
	const original = hint(params);
	for (const change of [
		{ view: { center: [0.1, 0], zoom: 1 } }, { captureRadius: 0.1 }, { captureSpeed: 0.1 },
		{ damping: uniform(0.2) }, { restoringStrength: uniform(2) }, { timeStep: 0.01 }, { initialVelocity: [1, 0] },
		{ magnets: [{ ...params.magnets[0], strength: 2 }] },
	]) assert.notEqual(hint({ ...params, ...change }).key, original.key);
	assert.notEqual(hint(params, ['travelDistance']).key, original.key);
	assert.equal(hint(params, ['output', 'travelDistance']).key, hint(params, ['travelDistance', 'output']).key);
	assert.equal(hint({ ...params, magnets: [{ ...params.magnets[0], color: uniform([0, 1, 0, 1]) }], settlingShading: 1 }).key, original.key);
});

// 【物理係数に画像を使う場合は、入力内容を識別できないヒントを返さない】
// 同じテクスチャでも上流の更新で収束が遅くなり得るため、uniformのときだけ学習を再利用する。
test('does not reuse work estimates for texture-driven physical coefficients', () => {
	for (const name of ['damping', 'restoringStrength']) {
		assert.equal(hint({ ...parameters(), [name]: { kind: 'texture', texture: {} } }), null);
	}
});
