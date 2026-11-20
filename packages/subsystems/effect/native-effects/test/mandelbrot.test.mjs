import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMandelbrotSettings } from '../src/fx/mandelbrot/mandelbrot-settings.ts';
import { buildMandelbrotReferenceOrbit } from '../src/fx/mandelbrot/reference-orbit.ts';
import { packMandelbrotNumber, packMandelbrotFixedPoint } from '../src/fx/mandelbrot/extended-precision.ts';

const request = (overrides = {}) => ({ center: ['-1', '0'], centerOffset: [0, 0], precisionBits: 448, maximumIterations: 512, bailoutRadius: 2, usePerturbation: true, ...overrides });
const build = value => buildMandelbrotReferenceOrbit(value, new AbortController().signal);
const unpack = (data, offset) => {
	const integers = new Uint32Array(data);
	const exponent = new Int32Array(data)[offset + 2];
	return (integers[offset] + integers[offset + 1] * 2 ** 32) * 2 ** (exponent - 48) * (integers[offset + 3] === 0 ? 1 : -1);
};

// 【周期2の既知の軌道を、正規化したGPU転送形式で保持する】
// z=0,-1,0,-1,...という解析解から、反復の開始位置・指数の意味・48byteのstrideを検証する。
test('packs an analytic period-two reference orbit without losing zero states', async () => {
	const orbit = await build(request());
	assert.equal(orbit.data.byteLength, 513 * 48);
	assert.deepEqual(orbit.center, [-1, 0]);
	for (let iteration = 0; iteration <= 512; iteration++) {
		assert.equal(unpack(orbit.data, iteration * 12), iteration % 2 === 0 ? 0 : -1);
		assert.equal(unpack(orbit.data, iteration * 12 + 4), 0);
		assert.equal(unpack(orbit.data, iteration * 12 + 8), iteration % 2 === 0 ? -4 : -3);
	}
});

// 【numberへ変換すると同じ値になる中心を、発散境界の内外として区別する】
// R=2に対する符号付き差を高精度で計算しなければ、f32の基準軌道だけでは両者とも-2になる。
test('distinguishes decimal reference centers beyond binary64 at the bailout boundary', async () => {
	const outside = await build(request({ center: ['-2.' + '0'.repeat(79) + '1', '0'] }));
	const inside = await build(request({ center: ['-1.' + '9'.repeat(80), '0'] }));
	assert.equal(outside.data.byteLength, 2 * 48);
	assert.equal(inside.data.byteLength, 513 * 48);
	assert.ok(unpack(outside.data, 20) > 0);
	assert.ok(unpack(inside.data, 20) < 0);
	assert.ok(new Int32Array(outside.data)[22] < -200);
});

// 【小さい移動量を高精度の基準中心へ加えてから軌道を計算する】
// 基準中心をnumberへ変換してから加算すると、1e-80の移動が失われ発散半径を超えたことが分からなくなる。
test('adds tiny local offsets before rounding a reference center', async () => {
	const orbit = await build(request({ center: ['-2', '0'], centerOffset: [-1e-80, 0] }));
	assert.equal(orbit.data.byteLength, 96);
	assert.ok(unpack(orbit.data, 20) > 0);
	const scientific = await build(request({ center: ['-2.00000000000000000000000000000000000000000000000000000000000000000000000000000001e0', '.0e10'] }));
	assert.deepEqual(new Uint8Array(scientific.data), new Uint8Array(orbit.data));
});

// 【通常のズームでは軌道バッファを作らず、入力エラーを準備段階で報告する】
// 不正な文字列を黙って0へ置換したり、巨大な指数でBigInt演算を開始したりしないことを確認する。
test('prepares direct rendering and rejects malformed reference coordinates', async () => {
	assert.equal((await build(request({ usePerturbation: false }))).data.byteLength, 48);
	for (const coordinate of ['', 'NaN', 'Infinity', '1.2.3', '1e99999']) {
		await assert.rejects(build(request({ center: [coordinate, '0'] })), /coordinate/);
	}
	await assert.rejects(build(request({ center: ['1e13', '0'] })), /center components/);
});

// 【極深ズームの倍率をf32へ実体化せず、画素と反復数に応じた精度を用意する】
// 指数を分離しない倍率はGPU上で0になる。無効な値はprecisionBitsやバッファ長を壊す前に拒否する。
test('plans finite scaled zooms and bounds the iteration budget', () => {
	const shallow = getMandelbrotSettings({ center: [0, 0], zoom: 1 }, 512, 1e10, 1920);
	const deep = getMandelbrotSettings({ center: [0, 0], zoom: 1e300 }, 1e6, 1e20, 3840);
	assert.equal(shallow.usePerturbation, false);
	assert.equal(deep.usePerturbation, true);
	assert.equal(deep.maximumIterations, 65536);
	assert.equal(deep.bailoutRadius, 1e12);
	assert.ok(deep.precisionBits > 1000);
	const packedScale = packMandelbrotNumber(deep.complexScale);
	assert.ok(packedScale.exponent < -900);
	assert.ok(packedScale.significand[1] >= 0x8000 && packedScale.significand[1] < 0x10000);
	assert.ok(Math.abs(deep.complexScale / 4e-300 - 1) < 1e-14);
	assert.throws(() => getMandelbrotSettings({ center: [NaN, 0], zoom: 1 }, 512, 2, 1), /finite/);
});

// 【長い基準軌道の計算を、ワーカーへ制御を戻した境界で中断する】
// カメラ移動や破棄の後も古い多倍長計算が走り続けると、新しいフレームの準備を妨げる。
test('cancels a long reference calculation while it is yielding', async () => {
	const controller = new AbortController();
	const pending = buildMandelbrotReferenceOrbit(request({ maximumIterations: 65536 }), controller.signal);
	controller.abort();
	await assert.rejects(pending, error => error.name === 'AbortError');
});

// 【CPUからGPUへ48bit仮数を渡す際の偶数丸めと指数の繰り上がりを検証する】
// 桁数の境界だけで1ulpずれるcodecは、深ズームで全画素へ同じ誤差を注入してしまう。
test('packs signed 48-bit significands with ties-to-even and wide exponents', () => {
	const unpackValue = value => (value.significand[0] + value.significand[1] * 2 ** 32) * 2 ** (value.exponent - 48) * (value.negative === 0 ? 1 : -1);
	for (const value of [0, -1, 1, 0.5, 1e-300, 1e300]) assert.ok(Math.abs(unpackValue(packMandelbrotNumber(value)) - value) <= Math.abs(value) * 4e-15);
	assert.deepEqual(packMandelbrotFixedPoint((1n << 49n) + 2n, 49), packMandelbrotNumber(1));
	assert.deepEqual(packMandelbrotFixedPoint((1n << 49n) + 6n, 49), packMandelbrotFixedPoint((1n << 47n) + 2n, 47));
	assert.deepEqual(packMandelbrotFixedPoint((1n << 49n) - 1n, 49), packMandelbrotNumber(1));
});

const { loadNativePreparation, preparationGpu, createPreparationInstance } = await import('./helpers/native-preparation.mjs');
const load = await loadNativePreparation('mandelbrot', ['./reference-orbit.ts']);
async function orbitFixture() {
	const jobs = [], { gpu, allocations } = preparationGpu();
	const native = load({ './reference-orbit.ts': { buildMandelbrotReferenceOrbit(request, signal) {
		const pending = Promise.withResolvers();
		jobs.push({ request, signal, ...pending });
		return pending.promise;
	} } });
	let center = '-1';
	const instance = await createPreparationInstance(native, gpu, { inputs: { referenceCenter: { kind: 'struct', fields: {
		real: { kind: 'value', get value() { return center; } }, imaginary: { kind: 'value', value: '0' },
	} } } });
	return { jobs, instance, allocations, seek(value, signal) { center = value; return instance.prepare({ time: 0, timeDelta: 0 }, signal); } };
}
const orbit = () => ({ data: new ArrayBuffer(48), center: [0, 0] });

// 【軌道を二件まで保持し、中断した計算をGPUへ転送しない】
// 往復するシークで同じ軌道を再生成せず、再参照した項目の寿命も更新する。
test('caches recently used orbits and discards superseded results', async t => {
	const f = await orbitFixture(); t.after(() => f.instance.dispose());
	const first = assert.rejects(f.seek('-1'), { name: 'AbortError' });
	const next = f.seek('-0.75');
	assert.ok(f.jobs[0].signal.aborted);
	const count = f.allocations.length;
	f.jobs[0].resolve(orbit()); await first;
	assert.equal(f.allocations.length, count);
	f.jobs[1].resolve(orbit()); await next;
	const other = f.seek('-1'); f.jobs[2].resolve(orbit()); await other;
	await f.seek('-0.75'); await f.seek('-1');
	const third = f.seek('0'); f.jobs[3].resolve(orbit()); await third;
	await f.seek('-1');
	assert.equal(f.jobs.length, 4);
});

// 【準備の中断後は同じ要求をやり直せる】
// 中断後や破棄後に届いた軌道のために新しいバッファを作らないことを確認する。
test('restarts cancelled orbit preparation and ignores late disposal completions', async () => {
	const f = await orbitFixture(), controller = new AbortController();
	const cancelled = assert.rejects(f.seek('-1', controller.signal), { name: 'AbortError' });
	controller.abort(); await cancelled;
	const retry = assert.rejects(f.seek('-1'), { name: 'AbortError' });
	const count = f.allocations.length;
	f.instance.dispose();
	for (const job of f.jobs) job.resolve(orbit());
	await retry; await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.jobs.length, 2);
	assert.equal(f.allocations.length, count);
	assert.ok(f.allocations.every(resource => resource.destroyed === 1));
});

// 【基準軌道の計算失敗を伝え、次の座標で回復する】
// 書き出しが古い軌道で続行されることを防ぎ、次のフレームは独立して準備する。
test('reports reference errors and recovers on a changed request', async t => {
	const f = await orbitFixture(); t.after(() => f.instance.dispose());
	const failed = assert.rejects(f.seek('-1'), /invalid coordinate/);
	f.jobs[0].reject(new Error('invalid coordinate')); await failed;
	assert.equal(f.instance.preparationStatus.type, 'error');
	const retry = f.seek('0'); f.jobs[1].resolve(orbit()); await retry;
	assert.equal(f.instance.preparationStatus.type, 'ready');
});
