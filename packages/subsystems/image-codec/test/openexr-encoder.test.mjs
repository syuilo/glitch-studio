import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { OpenExrEncoder } from '../src/openexr-encoder.ts';

const wasmBytes = await readFile(new URL('../src/codec/tinyexr.wasm', import.meta.url));
const wasmBinary = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

// TinyEXRのデコーダーを共用せず、ファイル構造とZIPの逆変換を独立して検証する。
function readExr(buffer) {
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	assert.equal(view.getUint32(0, true), 20000630);
	assert.equal(view.getUint32(4, true), 2);
	let position = 8;
	const string = () => { const end = bytes.indexOf(0, position); const text = new TextDecoder().decode(bytes.subarray(position, end)); position = end + 1; return text; };
	const attributes = {};
	for (let name; (name = string()) !== '';) {
		const type = string();
		const length = view.getUint32(position, true);
		position += 4;
		attributes[name] = { type, bytes: bytes.subarray(position, position + length) };
		position += length;
	}
	const window = new DataView(attributes.dataWindow.bytes.buffer, attributes.dataWindow.bytes.byteOffset, 16);
	const width = window.getInt32(8, true) + 1;
	const height = window.getInt32(12, true) + 1;
	const table = position;
	const channels = [];
	position = attributes.channels.bytes.byteOffset;
	for (let name; (name = string()) !== '';) {
		assert.equal(view.getInt32(position, true), 1, 'HALF channel');
		channels.push(name);
		position += 16;
	}
	assert.deepEqual(channels, ['A', 'B', 'G', 'R']);
	const compression = attributes.compression.bytes[0];
	const rowsPerBlock = compression === 3 ? 16 : 1;
	const pixels = new Uint16Array(width * height * 4);
	for (let block = 0; block < Math.ceil(height / rowsPerBlock); block++) {
		position = Number(view.getBigUint64(table + block * 8, true));
		const y = view.getInt32(position, true);
		assert.equal(y, block * rowsPerBlock);
		const length = view.getUint32(position + 4, true);
		const rawLength = width * Math.min(rowsPerBlock, height - y) * 8;
		let raw = bytes.subarray(position + 8, position + 8 + length);
		if (compression === 3 && length < rawLength) {
			const predicted = inflateSync(raw);
			for (let index = 1; index < predicted.length; index++) predicted[index] = (predicted[index - 1] + predicted[index] - 128) & 255;
			raw = new Uint8Array(rawLength);
			for (let index = 0; index < rawLength; index++) raw[index] = predicted[index % 2 === 0 ? index / 2 : Math.ceil(rawLength / 2) + (index - 1) / 2];
		}
		assert.equal(raw.length, rawLength);
		const samples = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		let offset = 0;
		for (let row = y; row < Math.min(y + rowsPerBlock, height); row++) {
			for (const channel of channels) for (let x = 0; x < width; x++) {
				pixels[(row * width + x) * 4 + 'RGBA'.indexOf(channel)] = samples.getUint16(offset, true);
				offset += 2;
			}
		}
	}
	return { attributes, pixels, width, height };
}

// 【HALFのHDR・負値・透明発光を圧縮方式によらず正確に保存する】
// half→float→halfの再量子化、alphaによる乗除算、上下反転、末尾ブロックの欠落を防ぐ。
// 奇数幅・16で割り切れない高さを使い、色空間メタデータも外部実装の規約で確認する。
for (const compression of ['none', 'zip']) {
	test(`preserves HALF pixels and color metadata with ${compression} compression`, async () => {
		const width = 5, height = 19;
		const input = new Uint16Array(width * height * 4);
		for (let pixel = 0; pixel < width * height; pixel++) input.set([0x4000 + pixel, 0xb800 + pixel, pixel, pixel % 2 === 0 ? 0 : 0x3800], pixel * 4);
		const encoder = await OpenExrEncoder.create({ width, height, compression }, wasmBinary);
		for (let row = 0; row < height; row += encoder.rowsPerBlock) encoder.writeBlock(input.subarray(row * width * 4, Math.min(row + encoder.rowsPerBlock, height) * width * 4));
		const result = readExr(encoder.finish());
		assert.deepEqual(result.pixels, input);
		assert.deepEqual([result.width, result.height], [width, height]);
		assert.equal(new TextDecoder().decode(result.attributes.colorInteropID.bytes), 'lin_rec709_scene');
		assert.equal(result.attributes.chromaticities.bytes.length, 32);
		assert.equal(result.attributes.acesImageContainerFlag, undefined);
		assert.throws(() => encoder.writeBlock(input), /closed/);
		encoder.dispose();
	});
}

// 【ZIPで小さくならないブロックも正しい生データとして保存する】
// ランダムなhalfのビット列は圧縮後に大きくなり得る。EXRの非圧縮フォールバックを
// 無視するとノイズ系の作品だけ読み込み不能になるため、全ビットを比較する。
test('preserves incompressible HALF bit patterns', async () => {
	const pixels = new Uint16Array(7 * 17 * 4);
	let seed = 0x12345678;
	for (let index = 0; index < pixels.length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[index] = seed >>> 16; }
	const encoder = await OpenExrEncoder.create({ width: 7, height: 17, compression: 'zip' }, wasmBinary);
	encoder.writeBlock(pixels.subarray(0, 7 * 16 * 4));
	encoder.writeBlock(pixels.subarray(7 * 16 * 4));
	assert.deepEqual(readExr(encoder.finish()).pixels, pixels);
});

// 【大きな出力でWASMのheapが成長しても後続ブロックを正しく書き込む】
// 古いHEAPU16を保持すると成長後のArrayBufferが切り離され、大きな画像だけで失敗する。
// 初期heapの16MiBを超える無圧縮画像で、成長前後と最終行の値を照合する。
test('keeps pixel views current when the WASM heap grows', async () => {
	const width = 1024, height = 2050;
	const encoder = await OpenExrEncoder.create({ width, height, compression: 'none' }, wasmBinary);
	const row = new Uint16Array(width * 4);
	for (let y = 0; y < height; y++) { row.fill(0x3800 + y % 512); encoder.writeBlock(row); }
	const pixels = readExr(encoder.finish()).pixels;
	for (let y = 0; y < height; y++) {
		assert.equal(pixels[y * width * 4], 0x3800 + y % 512);
		assert.equal(pixels[(y + 1) * width * 4 - 1], 0x3800 + y % 512);
	}
});

// 【途中終了と不正なブロックを検出し、同じWASM内の資源を確実に解放する】
// 不完全な画像を正常なEXRとして保存せず、エラー後のdisposeも安全に呼べる契約を保つ。
test('rejects invalid blocks and incomplete images and disposes safely', async () => {
	const encoder = await OpenExrEncoder.create({ width: 1, height: 17, compression: 'zip' }, wasmBinary);
	assert.throws(() => encoder.writeBlock(new Uint16Array(4)), /Invalid/);
	encoder.writeBlock(new Uint16Array(64));
	assert.throws(() => encoder.finish(), /incomplete/);
	encoder.dispose();
	assert.throws(() => encoder.finish(), /closed/);
	await assert.rejects(OpenExrEncoder.create({ width: 0, height: 1, compression: 'zip' }, wasmBinary), /dimensions/);
});
