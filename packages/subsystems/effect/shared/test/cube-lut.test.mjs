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

// 【同じBlobの準備を繰り返さず、差し替え・未選択・破棄で古い結果を捨てる】
// IDだけのキャッシュでは同じAssetの差し替えが反映されない。読み込みの完了順が逆転しても
// 最新の選択だけを公開し、未選択へ戻した後に古いGPUリソースを復活させない。
test('loads once per blob and ignores obsolete loads and errors', async () => {
	const statuses = [];
	const resources = [];
	const loader = createLutLoader(lut => {
		const resource = { lut, disposed: false, dispose() { this.disposed = true; } };
		resources.push(resource);
		return resource;
	}, state => statuses.push(state));
	let finishOld;
	const old = { size: 10, text: () => new Promise(resolve => { finishOld = resolve; }) };
	loader.prepare(old);
	const current = new Blob([identity1d]);
	loader.prepare(current);
	await flush();
	const version = loader.cacheVersion;
	loader.prepare(current);
	assert.equal(loader.cacheVersion, version);
	assert.equal(resources.length, 1);
	finishOld('invalid');
	await flush();
	assert.equal(statuses.at(-1).type, 'ready');
	assert.equal(loader.resource, resources[0]);
	loader.prepare(old);
	assert.equal(resources[0].disposed, true);
	loader.prepare(null);
	finishOld(identity1d);
	await flush();
	assert.equal(loader.ready, true);
	assert.equal(loader.resource, null);
	assert.equal(resources.length, 1);
	loader.prepare(current);
	await flush();
	loader.dispose();
	assert.equal(resources[1].disposed, true);
	loader.prepare(current);
	assert.equal(loader.resource, null);
});

// 【不正ファイルとGPU準備失敗を状態通知し、別のLUTで回復する】
// readyを通知してしまうと書き出しが誤った画素で進む。失敗後の差し替えは再試行できる。
test('reports parsing and resource errors and recovers on replacement', async () => {
	const statuses = [];
	const loader = createLutLoader(() => { throw new Error('GPU limit'); }, state => statuses.push(state));
	loader.prepare(new Blob(['LUT_1D_SIZE 2']));
	await flush();
	assert.match(statuses.at(-1).message, /Expected 2 LUT entries/);
	assert.equal(loader.ready, false);
	loader.prepare(new Blob([identity1d]));
	await flush();
	assert.match(statuses.at(-1).message, /GPU limit/);
	loader.prepare({ size: MAX_CUBE_FILE_BYTES + 1, text() { throw new Error('Must not read'); } });
	await flush();
	assert.match(statuses.at(-1).message, /file limit/);
	loader.prepare(null);
	assert.equal(loader.ready, true);
	assert.equal(statuses.at(-1).type, 'ready');
});
