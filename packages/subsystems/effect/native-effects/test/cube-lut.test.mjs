import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCubeLut, MAX_CUBE_FILE_BYTES } from '../src/fx/applyLut/cube.ts';

const identity3d = '0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
const identity1d = 'LUT_1D_SIZE 2\n0 0 0\n1 1 1';

// 【1Dと3Dのデータ順序・入力範囲を保存し、非表示の書式差を許容する】
// 赤が最速で変わる3D表を並べ替えたり、DOMAINのRGB別の値を一つにまとめると色が変わる。
// BOM・CRLF・コメント・指数表記を含むファイルも同じ数値表として扱う。
test('parses RGB domains, red-fastest tables and common text formatting', () => {
	const result = parseCubeLut('\uFEFF# cube\r\nTITLE "Test # LUT"\r\nLUT_3D_SIZE 2\r\nDOMAIN_MIN -1 0 1\r\nDOMAIN_MAX 1 2 3\r\n' + identity3d.replaceAll('\n', '\r\n'));
	assert.equal(result.oneDimensional, null);
	assert.deepEqual(result.threeDimensional.min, [-1, 0, 1]);
	assert.deepEqual(result.threeDimensional.max, [1, 2, 3]);
	assert.deepEqual([...result.threeDimensional.values.slice(4, 8)], [1, 0, 0, 1]);
	assert.deepEqual([...result.threeDimensional.values.slice(16, 20)], [0, 0, 1, 1]);
	const one = parseCubeLut('LUT_1D_SIZE 2\nLUT_1D_INPUT_RANGE -1 2\n-2e-1 .5 +2.\n# comment\n1 2 3 # end').oneDimensional;
	assert.deepEqual(one.min, [-1, -1, -1]);
	assert.deepEqual(one.max, [2, 2, 2]);
	assert.deepEqual([...one.values], [Math.fround(-0.2), 0.5, 2, 1, 1, 2, 3, 1]);
});

// 【複合LUTでは1Dを先に読み、各段階の入力範囲を別々に保持する】
// shaperを捨てたり3Dの範囲を使い回すと、構文上正しいのに異なる色変換になる。
test('keeps both stages and their independent ranges', () => {
	const result = parseCubeLut('LUT_3D_SIZE 2\nLUT_1D_SIZE 2\nLUT_1D_INPUT_RANGE -1 1\nLUT_3D_INPUT_RANGE 0 2\n1 1 1\n0 0 0\n' + identity3d);
	assert.deepEqual([...result.oneDimensional.values], [1, 1, 1, 1, 0, 0, 0, 1]);
	assert.deepEqual(result.oneDimensional.min, [-1, -1, -1]);
	assert.deepEqual(result.threeDimensional.max, [2, 2, 2]);
	assert.deepEqual([...result.threeDimensional.values.slice(-4)], [1, 1, 1, 1]);
});

// 【誤った色を黙って描画せず、不完全・矛盾・未対応のファイルを診断する】
// 数値のInfinity化や巨大サイズによる確保も、GPUリソースを作る前に止める。
test('rejects malformed, conflicting and oversized tables with diagnostics', () => {
	for (const [source, message] of [
		['', /Missing/], ['0 0 0', /Missing/], ['LUT_3D_SIZE 129', /between/],
		['LUT_1D_SIZE 65537', /between/], ['LUT_1D_SIZE 1', /between/], ['LUT_3D_SIZE 2.5', /integer/],
		['LUT_1D_SIZE 2\n0 0 0', /Expected 2 LUT entries/], [identity1d + '\n0 0 0', /Too many/],
		['LUT_1D_SIZE 2\n0 1\n1 1 1', /3 numeric/], ['LUT_1D_SIZE 2\n0 0 1e100\n1 1 1', /finite number/],
		['LUT_1D_SIZE 2\n0 0 NaN\n1 1 1', /finite number/],
		['LUT_1D_SIZE 2\nLUT_1D_SIZE 2', /Duplicate/], [identity1d + '\nDOMAIN_MIN 0 0 0', /precede/],
		['LUT_1D_SIZE 2\nDOMAIN_MAX 0 1 1\n0 0 0\n1 1 1', /positive span/],
		['LUT_1D_SIZE 2\nDOMAIN_MIN 0 0 0\nLUT_1D_INPUT_RANGE -1 1\n0 0 0', /conflicts/],
		['LUT_1D_SIZE 2\nLUT_3D_INPUT_RANGE 0 1\n0 0 0', /corresponding/],
		['LUT_1D_SIZE 2\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\n0 0 0', /ambiguous/],
		['LUT_1D_SIZE 2\nUNKNOWN 1\n0 0 0', /Unsupported/],
	]) assert.throws(() => parseCubeLut(source), message, source);
});

// 【非2冪のサイズと同値の範囲指定を受け付ける】
// 実際のLUTでは33や65なども使うため、テクスチャ寸法を2冪に限定しない。
test('accepts non-power-of-two grids and agreeing range declarations', () => {
	const lut = parseCubeLut('LUT_3D_SIZE 3\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\nLUT_3D_INPUT_RANGE 0 2\n' + Array(27).fill('0 0 0').join('\n'));
	assert.equal(lut.threeDimensional.size, 3);
	assert.equal(lut.threeDimensional.values.length, 108);
});

const { loadNativePreparation, preparationGpu, createPreparationInstance } = await import('./helpers/native-preparation.mjs');
const native = (await loadNativePreparation('applyLut'))();
function placement(file, gpu, signal) {
	return createPreparationInstance(native, gpu, { staticSettings: { lut: file == null ? null : 'lut' },
		resources: { assets: [{ id: 'lut', name: 'table.cube', fileDataType: 'application/x-cube-lut', fileData: file }], assetTextures: new Map() } }, signal);
}

// 【旧配置の読み取りが後から完了しても新配置のLUTを置き換えない】
// 同時に読み込んだ二つの素材のうち、中断した配置のGPU資源を解放できることも確認する。
test('loads fixed sources and discards a cancelled initialization', async () => {
	const { gpu, allocations } = preparationGpu();
	const started = Promise.withResolvers(), text = Promise.withResolvers();
	const old = new Blob([identity1d]);
	old.text = () => { started.resolve(); return text.promise; };
	const controller = new AbortController();
	const stale = assert.rejects(placement(old, gpu, controller.signal), { name: 'AbortError' });
	await started.promise; controller.abort();
	const latest = await placement(new Blob([identity1d]), gpu);
	const count = allocations.length;
	text.resolve(identity1d); await stale;
	assert.equal(allocations.length, count);
	latest.dispose();
	assert.ok(allocations.every(resource => resource.destroyed === 1));
});

// 【構文・ファイルサイズ・GPU上限のエラーを初期化元へ返す】
// 一部の資源を確保してから失敗した場合にも書き出しを開始せず後始末する。
test('reports fixed-source parsing size and GPU resource failures', async () => {
	for (const [file, limit, message] of [
		[new Blob(['LUT_1D_SIZE 2']), 8192, /Expected 2 LUT entries/],
		[new Blob([identity1d]), 1, /GPU device limit/],
		[{ size: MAX_CUBE_FILE_BYTES + 1, url: 'file:unused', error: null }, 8192, /file limit/],
	]) {
		const { gpu, allocations } = preparationGpu();
		gpu.device.limits.maxTextureDimension2D = limit;
		// LUTの寸法だけを制限するため、出力の寸法はGPUが許す最小の1pxにする。
		await assert.rejects(createPreparationInstance(native, gpu, { resolution: { width: 1, height: 1 }, staticSettings: { lut: 'lut' },
			resources: { assets: [{ id: 'lut', name: 'table.cube', fileDataType: 'application/x-cube-lut', fileData: file }], assetTextures: new Map() } }), message);
		assert.ok(allocations.every(resource => resource.destroyed === 1));
	}
});

// 【素材未選択でも入力を通す配置を準備できる】
// 空のLUTはファイル取得を発生させず、その配置が所有するGPU資源だけを解放する。
test('is ready without loading an unselected LUT', async () => {
	const { gpu, allocations } = preparationGpu();
	const instance = await placement(null, gpu);
	assert.equal(instance.tryPrepare({ time: 0, timeDelta: 0 }), true);
	instance.dispose();
	assert.ok(allocations.every(resource => resource.destroyed === 1));
});
