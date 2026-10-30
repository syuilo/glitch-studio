import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCubeLut, MAX_CUBE_FILE_BYTES } from '../src/fx/applyLut/cube.ts';
import { createLutLoader } from '../src/fx/applyLut/lut-loader.ts';

const identity3d = '0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
const identity1d = 'LUT_1D_SIZE 2\n0 0 0\n1 1 1';
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

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

// 【素材ごとに作り直したローダーは破棄済みの結果を公開しない】
// 静的設定・Asset差し替えではローダーを破棄するため、古い読み込みが後から成功・失敗しても影響させない。
test('loads fixed sources and ignores completions from disposed loaders', async () => {
	const statuses = [];
	const resources = [];
	const createResource = lut => {
		const resource = { lut, disposed: false, dispose() { this.disposed = true; } };
		resources.push(resource);
		return resource;
	};
	let finishOld;
	const old = { size: 10, text: () => new Promise(resolve => { finishOld = resolve; }) };
	const oldStatuses = [];
	const oldLoader = createLutLoader(old, createResource, state => oldStatuses.push(state));
	oldLoader.dispose();
	const loader = createLutLoader(new Blob([identity1d]), createResource, state => statuses.push(state));
	await flush();
	const version = loader.cacheVersion;
	assert.equal(resources.length, 1);
	assert.equal(loader.ready, true);
	finishOld('invalid');
	await flush();
	assert.deepEqual(oldStatuses, [{ type: 'loading' }]);
	assert.equal(statuses.at(-1).type, 'ready');
	assert.equal(loader.resource, resources[0]);
	assert.equal(loader.cacheVersion, version);
	loader.dispose();
	assert.equal(resources[0].disposed, true);
	assert.equal(loader.resource, null);
});

// 【不正ファイルとGPU準備失敗を状態通知する】
// 素材は固定でも読み込みは非同期なので、readyで誤った書き出しを進めず原因を通知する必要がある。
test('reports fixed-source parsing size and GPU resource failures', async () => {
	for (const [fileSource, message] of [
		[new Blob(['LUT_1D_SIZE 2']), /Expected 2 LUT entries/],
		[new Blob([identity1d]), /GPU limit/],
		[{ size: MAX_CUBE_FILE_BYTES + 1, text() { throw new Error('Must not read'); } }, /file limit/],
	]) {
		const statuses = [];
		const loader = createLutLoader(fileSource, () => { throw new Error('GPU limit'); }, state => statuses.push(state));
		await flush();
		assert.match(statuses.at(-1).message, message);
		assert.equal(loader.ready, false);
		loader.dispose();
	}
});

// 【未選択のLUTは読み込みやGPU確保を行わず準備完了になる】
// 初期化時のnullを要求済み素材と区別する状態管理を持たず、入力を通す状態で開始できるようにする。
test('is ready without loading or allocating an unselected LUT', () => {
	const statuses = [];
	const loader = createLutLoader(null, () => assert.fail('must not allocate'), state => statuses.push(state));
	assert.equal(loader.ready, true);
	assert.equal(loader.resource, null);
	assert.deepEqual(statuses, [{ type: 'ready' }]);
	loader.dispose();
});
