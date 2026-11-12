import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDoublePendulumFractalRenderWorkloadHint } from '../src/fx/doublePendulumFractal/render-workload.ts';

const parameters = () => ({
	simulationTime: 3, timeStep: 0.01, antialiasing: false, view: { center: [0, 0], zoom: 1 },
	initialAngularVelocity1: 0, initialAngularVelocity2: 0, lengthRatio: 1, massRatio: 1, gravity: 9.81,
	coloringMethod: 'angle1', angularVelocityRange: 10,
	ramp: { interpolation: 'linear', colorSpace: 'srgb', stops: [
		{ id: 'start', position: 0, color: [0, 0, 0, 1] }, { id: 'end', position: 1, color: [1, 1, 1, 1] },
	] },
});
const hint = (params, ports = ['output']) => getDoublePendulumFractalRenderWorkloadHint({ params, usedOutputPorts: new Set(ports) });

// 【時間・刻み・AAによる計算量の増加を、描画前のタイル面積縮小へ反映する】
// 全画素が同じスケジュールで積分されるため、時間や刻みの変更は実際の積分回数で比較できる。
test('scales double pendulum work with integration steps and antialiasing', () => {
	const params = parameters();
	const original = hint(params);
	assert.equal(original.workPerPixel, 301);
	for (const change of [{ simulationTime: 6 }, { timeStep: 0.005 }]) {
		const heavier = hint({ ...params, ...change });
		assert.equal(heavier.key, original.key);
		assert.equal(heavier.workPerPixel, 601);
	}
	const antialiased = hint({ ...params, antialiasing: true });
	assert.equal(antialiased.key, original.key);
	assert.equal(antialiased.workPerPixel, original.workPerPixel * 4);
});

// 【端数の1ステップを見落とさず、時刻0でも正の計算量を返す】
// 浮動小数の除算誤差で0.3/0.1を4回と数えたり、GPUで0になる微小端数を数えたりしない。
test('matches exact, partial and zero-duration GPU integration schedules', () => {
	for (const [simulationTime, timeStep, expected] of [
		[0, 0.01, 1], [-1, 0.01, 1], [0.3, 0.1, 4], [1.005, 0.01, 102], [0.001, 0.01, 2], [1e-100, 0.01, 1],
	]) assert.equal(hint({ ...parameters(), simulationTime, timeStep }).workPerPixel, expected);
});

// 【物理条件・表示領域・配色の処理方式が変われば、以前の計測を流用しない】
// Rampの色だけの変更では処理方式が変わらないため、通常描画へ戻った状態を維持できる。
test('identifies physical and rendering conditions without invalidating ramp color edits', () => {
	const params = parameters();
	const original = hint(params);
	for (const change of [
		{ view: { center: [0.1, 0], zoom: 1 } }, { view: { center: [0, 0], zoom: 2 } },
		{ initialAngularVelocity1: 1 }, { initialAngularVelocity2: 1 }, { lengthRatio: 2 }, { massRatio: 2 }, { gravity: 0 },
		{ coloringMethod: 'angle2' }, { angularVelocityRange: 20 },
		{ ramp: { ...params.ramp, interpolation: 'constant' } }, { ramp: { ...params.ramp, colorSpace: 'oklab' } },
		{ ramp: { ...params.ramp, stops: [...params.ramp.stops, { id: 'middle', position: 0.5, color: [1, 0, 0, 1] }] } },
	]) assert.notEqual(hint({ ...params, ...change }).key, original.key);
	assert.equal(hint({ ...params, ramp: { ...params.ramp, stops: params.ramp.stops.map(stop => ({ ...stop, color: [1, 0, 0, 1] })) } }).key, original.key);
});

// 【未使用の配色設定を、データ出力だけの描画の計算量へ混ぜない】
// 複数ポートのために積分を繰り返したり、ポート列挙順だけで再計測したりすることを防ぐ。
test('shares integration across output ports and ignores unused coloring settings', () => {
	const params = parameters();
	const ports = ['angle1', 'angularVelocity2'];
	const dataOnly = hint(params, ports);
	assert.equal(dataOnly.workPerPixel, hint(params).workPerPixel);
	assert.equal(dataOnly.key, hint(params, [...ports].reverse()).key);
	assert.equal(dataOnly.key, hint({ ...params, coloringMethod: 'sphericalRgb', angularVelocityRange: 100,
		ramp: { ...params.ramp, stops: [], colorSpace: 'oklab' } }, ports).key);
	assert.notEqual(dataOnly.key, hint(params, ['angle1']).key);
	const spherical = { ...params, coloringMethod: 'sphericalRgb' };
	assert.equal(hint(spherical).key, hint({ ...spherical, ramp: { ...params.ramp, stops: [] } }).key);
});

// 【描画できない積分スケジュールを、軽いヒントへ丸めて受け付けない】
// 上限超過や不正な刻みに対し、既存の描画と同じ診断を保つ。
test('preserves integration validation when computing workload hints', () => {
	assert.throws(() => hint({ ...parameters(), simulationTime: 100 }), /4096 integration steps/);
	assert.throws(() => hint({ ...parameters(), timeStep: 0 }), /Time Step/);
	assert.throws(() => hint({ ...parameters(), simulationTime: NaN }), /Simulation Time/);
});
