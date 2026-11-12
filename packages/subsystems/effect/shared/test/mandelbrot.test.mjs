import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMandelbrotSettings } from '../src/fx/mandelbrot/mandelbrot-settings.ts';
import { buildMandelbrotReferenceOrbit } from '../src/fx/mandelbrot/reference-orbit.ts';
import { createMandelbrotReferenceLoader } from '../src/fx/mandelbrot/reference-orbit-loader.ts';
import { packMandelbrotNumber, packMandelbrotFixedPoint } from '../src/fx/mandelbrot/extended-precision.ts';

const request = (overrides = {}) => ({ center: ['-1', '0'], centerOffset: [0, 0], precisionBits: 448, maximumIterations: 512, bailoutRadius: 2, usePerturbation: true, ...overrides });
const build = value => buildMandelbrotReferenceOrbit(value, new AbortController().signal);
const settle = () => new Promise(resolve => setImmediate(resolve));
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

// 【古い要求の完了を無視し、同じ条件の準備とシークでは軌道を再利用する】
// buildが中断に応じない場合にも世代を混在させず、完了時だけキャッシュ世代とreadyを更新する。
test('publishes only the latest reference and caches completed requests', async () => {
	const jobs = [];
	const published = [];
	const statuses = [];
	const loader = createMandelbrotReferenceLoader({
		build: (_request, signal) => { const pending = Promise.withResolvers(); jobs.push({ ...pending, signal }); return pending.promise; },
		publish: orbit => published.push(orbit), reportStatus: status => statuses.push(status.type),
	});
	const first = request();
	const second = request({ center: ['-0.75', '0'] });
	loader.prepare(first); loader.prepare(first);
	assert.equal(jobs.length, 1);
	loader.prepare(second);
	assert.equal(jobs[0].signal.aborted, true);
	jobs[0].resolve({ name: 'stale' }); await settle();
	assert.deepEqual(published, []);
	jobs[1].resolve({ name: 'second' }); await settle();
	assert.equal(loader.ready, true);
	assert.equal(loader.cacheVersion, 1);
	loader.prepare(first); jobs[2].resolve({ name: 'first' }); await settle();
	loader.prepare(second);
	assert.equal(jobs.length, 3);
	assert.deepEqual(published.map(orbit => orbit.name), ['second', 'first', 'second']);
	assert.equal(loader.cacheVersion, 3);
	assert.deepEqual(statuses, ['loading', 'loading', 'ready', 'loading', 'ready', 'ready']);
	loader.prepare(first);
	loader.prepare(request({ center: ['0', '0'] })); jobs[3].resolve({ name: 'third' }); await settle();
	loader.prepare(first);
	assert.equal(jobs.length, 4);
	assert.equal(published.at(-1).name, 'first');
	loader.dispose();
});

// 【同じ要求の待機主体が変わった場合、古いAbortSignalを切り離す】
// プレビューから書き出しへ同じViewを引き継いだ後に、古い待機の中断で新しい準備まで止めないようにする。
test('rebinds cancellation, restarts aborted requests and ignores disposal completions', async () => {
	const jobs = [];
	const published = [];
	const loader = createMandelbrotReferenceLoader({
		build: (_request, signal) => { const pending = Promise.withResolvers(); jobs.push({ ...pending, signal }); return pending.promise; },
		publish: orbit => published.push(orbit), reportStatus: () => {},
	});
	const previous = new AbortController();
	const current = new AbortController();
	loader.prepare(request(), previous.signal);
	loader.prepare(request(), current.signal);
	previous.abort(); assert.equal(jobs[0].signal.aborted, false);
	loader.prepare(request());
	current.abort(); assert.equal(jobs[0].signal.aborted, true);
	loader.prepare(request());
	assert.equal(jobs.length, 2);
	loader.dispose();
	jobs.forEach(job => job.resolve({ data: new ArrayBuffer(32), center: [0, 0] }));
	await settle(); assert.deepEqual(published, []);
});

// 【準備失敗をreadyとして扱わず、次の異なる要求で回復する】
// 失敗した軌道の代わりに古い表示範囲を描画したり、未処理のPromise rejectionを残したりしないようにする。
test('reports reference errors and recovers on a changed request', async () => {
	const statuses = [];
	let calls = 0;
	const loader = createMandelbrotReferenceLoader({
		build: async () => { if (calls++ === 0) throw new Error('invalid coordinate'); return { data: new ArrayBuffer(32), center: [0, 0] }; },
		publish: () => {}, reportStatus: status => statuses.push(status),
	});
	loader.prepare(request()); await settle();
	assert.equal(loader.ready, false);
	assert.deepEqual(statuses.at(-1), { type: 'error', message: 'invalid coordinate' });
	loader.prepare(request({ center: ['0', '0'] })); await settle();
	assert.equal(loader.ready, true);
	loader.dispose();
});
