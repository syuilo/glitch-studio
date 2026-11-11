import assert from 'node:assert/strict';
import { readFile, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { OpenExrEncoder } from '../src/openexr-encoder.ts';

const wasmBytes = await readFile(new URL('../src/codec/tinyexr.wasm', import.meta.url));
const wasmBinary = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);


async function createBufferedEncoder(options) {
	const chunks = [];
	let maximumHeapBytes = 0;
	const encoder = await OpenExrEncoder.create(options, async (chunk, position) => {
		maximumHeapBytes = Math.max(maximumHeapBytes, chunk.buffer.byteLength);
		chunks.push({ bytes: chunk.slice(), position });
	}, wasmBinary);
	return {
		rowsPerBlock: encoder.rowsPerBlock,
		writeBlock: pixels => encoder.writeBlock(pixels),
		dispose: () => encoder.dispose(),
		get maximumHeapBytes() { return maximumHeapBytes; },
		async finish() {
			const result = new Uint8Array(await encoder.finish());
			for (const { bytes, position } of chunks) result.set(bytes, position);
			return result.buffer;
		},
	};
}

// 【8192pxを超える幅と高さのHALF画像を、圧縮方式によらず正確に保存する】
// JS側だけでなく配布する実WASMにも旧上限が残っていないことを確認する。
// 横長・縦長を使ってメモリ消費を抑えながら、行境界・末尾ブロック・全画素を照合する。
for (const compression of ['none', 'zip']) {
	for (const [width, height] of [[16384, 17], [3, 8193]]) {
		test(`encodes ${width}x${height} HALF images with ${compression} compression`, async () => {
			const input = new Uint16Array(width * height * 4);
			for (let index = 0; index < input.length; index++) input[index] = (index * 17) & 0xffff;
			const encoder = await createBufferedEncoder({ width, height, compression });
			for (let row = 0; row < height; row += encoder.rowsPerBlock) {
				await encoder.writeBlock(input.subarray(row * width * 4, Math.min(row + encoder.rowsPerBlock, height) * width * 4));
			}
			const result = readExr(await encoder.finish());
			assert.deepEqual([result.width, result.height], [width, height]);
			assert.deepEqual(result.pixels, input);
		});
	}
}

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
		const encoder = await createBufferedEncoder({ width, height, compression });
		for (let row = 0; row < height; row += encoder.rowsPerBlock) await encoder.writeBlock(input.subarray(row * width * 4, Math.min(row + encoder.rowsPerBlock, height) * width * 4));
		const result = readExr(await encoder.finish());
		assert.deepEqual(result.pixels, input);
		assert.deepEqual([result.width, result.height], [width, height]);
		assert.equal(new TextDecoder().decode(result.attributes.colorInteropID.bytes), 'lin_rec709_scene');
		assert.equal(result.attributes.chromaticities.bytes.length, 32);
		assert.equal(result.attributes.acesImageContainerFlag, undefined);
		await assert.rejects(encoder.writeBlock(input), /closed/);
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
	const encoder = await createBufferedEncoder({ width: 7, height: 17, compression: 'zip' });
	await encoder.writeBlock(pixels.subarray(0, 7 * 16 * 4));
	await encoder.writeBlock(pixels.subarray(7 * 16 * 4));
	assert.deepEqual(readExr(await encoder.finish()).pixels, pixels);
});

// 【初期heapより大きい画像もWASMへ蓄積せず、全ブロックを正しく出力する】
// 出力バッファを残すと、圧縮が進むにつれてWASMのメモリが増え続ける。
// 初期heapの16MiBを超える無圧縮画像で、メモリ上限と全行の値を独立に照合する。
test('streams output larger than the WASM heap without retaining completed blocks', async () => {
	const width = 1024, height = 2050;
	const encoder = await createBufferedEncoder({ width, height, compression: 'none' });
	const row = new Uint16Array(width * 4);
	for (let y = 0; y < height; y++) { row.fill(0x3800 + y % 512); await encoder.writeBlock(row); }
	const pixels = readExr(await encoder.finish()).pixels;
	assert.ok(encoder.maximumHeapBytes < width * height * 8);
	for (let y = 0; y < height; y++) {
		assert.equal(pixels[y * width * 4], 0x3800 + y % 512);
		assert.equal(pixels[(y + 1) * width * 4 - 1], 0x3800 + y % 512);
	}
});

// 【16Kの2GiB超EXRをディスクへ逐次保存し、WASMへファイル全体を保持しない】
// 出力長・後書き位置の符号切り詰めに加え、チャンクを解放せず蓄積する回帰も検出する。
// 入力も一行だけ保持し、独立したファイル読み取りで最終scanlineのHALF値を確認する。
test('streams uncompressed 16K files larger than two GiB with bounded WASM memory', { skip: process.env.LARGE_OPENEXR_CODEC_TEST !== '1', timeout: 90000 }, async t => {
	const temporaryRoot = resolve(tmpdir());
	const directory = await mkdtemp(join(temporaryRoot, 'glitch-openexr-stream-'));
	const file = await open(join(directory, 'large.exr'), 'wx+');
	let encoder = null;
	let maximumHeapBytes = 0;
	try {
		const width = 16384, height = 16384;
		encoder = await OpenExrEncoder.create({ width, height, compression: 'none' }, async (chunk, position) => {
			maximumHeapBytes = Math.max(maximumHeapBytes, chunk.buffer.byteLength);
			assert.ok(chunk.byteLength <= 1024 * 1024);
			let offset = 0;
			while (offset < chunk.byteLength) {
				const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset, position + offset);
				assert.ok(bytesWritten > 0);
				offset += bytesWritten;
			}
		}, wasmBinary);
		const row = new Uint16Array(width * 4);
		for (let x = 0; x < width; x++) row.set([0x4000, 0xb800, 0x3c00, 0x3800], x * 4);
		for (let y = 0; y < height; y++) await encoder.writeBlock(row);
		const size = await encoder.finish();
		assert.ok(size > 2 ** 31);
		assert.equal((await file.stat()).size, size);
		assert.ok(maximumHeapBytes <= 64 * 1024 * 1024, 'the output must not grow the WASM heap with file size');
		t.diagnostic('16K output: ' + size + ' bytes; maximum WASM heap: ' + maximumHeapBytes + ' bytes');
		const lastBlock = Buffer.alloc(8 + width * 8);
		await file.read(lastBlock, 0, lastBlock.byteLength, size - lastBlock.byteLength);
		const view = new DataView(lastBlock.buffer, lastBlock.byteOffset, lastBlock.byteLength);
		assert.equal(view.getInt32(0, true), height - 1);
		assert.equal(view.getUint32(4, true), width * 8);
		for (const [channel, value] of [0x3800, 0x3c00, 0xb800, 0x4000].entries()) {
			assert.equal(view.getUint16(8 + channel * width * 2, true), value);
			assert.equal(view.getUint16(8 + (channel + 1) * width * 2 - 2, true), value);
		}
	} finally {
		encoder?.dispose();
		await file.close();
		assert.equal(dirname(resolve(directory)), temporaryRoot);
		assert.ok(basename(directory).startsWith('glitch-openexr-stream-'));
		await rm(directory, { recursive: true, force: true });
	}
});

// 【途中終了と不正なブロックを検出し、同じWASM内の資源を確実に解放する】
// 不完全な画像を正常なEXRとして保存せず、エラー後のdisposeも安全に呼べる契約を保つ。
test('rejects invalid blocks and incomplete images and disposes safely', async () => {
	const encoder = await createBufferedEncoder({ width: 1, height: 17, compression: 'zip' });
	await assert.rejects(encoder.writeBlock(new Uint16Array(4)), /Invalid/);
	await encoder.writeBlock(new Uint16Array(64));
	await assert.rejects(encoder.finish(), /incomplete/);
	encoder.dispose();
	await assert.rejects(encoder.finish(), /closed/);
	await assert.rejects(createBufferedEncoder({ width: 0, height: 1, compression: 'zip' }), /dimensions/);
});

// 【保存待ち中に次の圧縮・破棄へ進まず、保存先の失敗原因をそのまま返す】
// 借用viewを保存が終わる前に上書きしたり、ディスクエラーを汎用IO errorで隠したりしない。
test('awaits output writes and preserves writer errors during creation and encoding', async () => {
	const diskError = new Error('disk full');
	await assert.rejects(OpenExrEncoder.create({ width: 1, height: 1, compression: 'none' }, async () => { throw diskError; }, wasmBinary), error => error === diskError);
	const started = Promise.withResolvers();
	const release = Promise.withResolvers();
	let waitForWrite = false;
	const encoder = await OpenExrEncoder.create({ width: 1, height: 1, compression: 'none' }, async () => {
		if (waitForWrite) { started.resolve(); await release.promise; }
	}, wasmBinary);
	waitForWrite = true;
	const writing = encoder.writeBlock(new Uint16Array(4));
	await started.promise;
	await assert.rejects(encoder.writeBlock(new Uint16Array(4)), /already in progress/);
	assert.throws(() => encoder.dispose(), /while writing/);
	release.reject(diskError);
	await assert.rejects(writing, error => error === diskError);
	encoder.dispose();
});
