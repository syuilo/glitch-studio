import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import decode, { init as initDecode } from '@jsquash/webp/decode.js';
import { WebpEncoder } from '../src/webp-encoder.ts';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const bytes = await readFile(new URL('../src/codec/webp.wasm', import.meta.url));
const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
await initDecode({ wasmBinary: await readFile(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')) });

function pixelsFor(width, height) {
	const pixels = new Uint8Array(width * height * 4);
	let random = 0x12345678;
	for (let index = 0; index < pixels.length; index += 4) {
		random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
		pixels[index] = random >>> 24;
		pixels[index + 1] = random >>> 16;
		pixels[index + 2] = random >>> 8;
		pixels[index + 3] = random;
	}
	return pixels;
}

async function prepare(width, height, pixels, lossless = true) {
	const encoder = await WebpEncoder.create({ width, height, lossless, quality: 75 }, wasmBinary);
	for (let row = 0; row < height; row += encoder.rowsPerBlock) {
		encoder.writeBlock(pixels.subarray(row * width * 4, Math.min(row + encoder.rowsPerBlock, height) * width * 4));
	}
	return encoder;
}

async function collect(encoder) {
	const chunks = [];
	let completed = 0;
	let size = 0;
	await encoder.encode(async (chunk, completedBytes, totalBytes) => {
		assert.ok(chunk.byteLength <= 1024 * 1024);
		completed += chunk.byteLength;
		assert.equal(completedBytes, completed);
		size = totalBytes;
		chunks.push(chunk.slice());
	});
	assert.equal(completed, size);
	return new Blob(chunks).arrayBuffer();
}

// 【形式上限の幅と8K超の高さを、透明画素のRGBも含めて可逆で保存する】
// 行ブロックの末尾・ARGBの色順・exact指定を独立したデコーダーで検証する。
// 全画像のC++入力コピーをなくしても、行間や透明領域の色を欠落させてはいけない。
for (const [width, height] of [[16383, 3], [17, 8193], [3, 2]]) {
	test(`preserves every RGBA byte in lossless ${width}x${height} WebP`, async () => {
		const pixels = pixelsFor(width, height);
		const encoded = await collect(await prepare(width, height, pixels));
		const decoded = await decode(encoded);
		assert.deepEqual([decoded.width, decoded.height], [width, height]);
		assert.deepEqual(new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), pixels);
	});
}

// 【非可逆ではYUVへ変換して入力ARGBを解放し、alphaは可逆で保持する】
// 可逆向けの入力経路への統一で、非可逆書き出しのalphaや寸法を壊さないようにする。
test('preserves alpha while encoding lossy RGB', async () => {
	const pixels = pixelsFor(17, 19);
	const decoded = await decode(await collect(await prepare(17, 19, pixels, false)));
	assert.deepEqual(Array.from(decoded.data).filter((_, index) => index % 4 === 3),
		Array.from(pixels).filter((_, index) => index % 4 === 3));
});

// 【保存先が一チャンクを処理し終わるまで、次の出力を生成側へ積み上げない】
// 同期のlibwebpから非同期の保存完了を待つ。単にpostMessageを繰り返す実装では、
// 全結果相当のコピーがWorker通信キューに滞留してメモリ削減にならない。
test('waits for the asynchronous writer before delivering the next chunk', async () => {
	const encoder = await prepare(1025, 513, pixelsFor(1025, 513));
	const writing = Promise.withResolvers();
	const release = Promise.withResolvers();
	let calls = 0;
	const job = encoder.encode(async () => {
		calls++;
		if (calls === 1) { writing.resolve(); await release.promise; }
	});
	await writing.promise;
	assert.equal(calls, 1);
	assert.throws(() => encoder.dispose(), /while encoding/);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls, 1);
	release.resolve();
	await job;
	assert.ok(calls >= 3);
});

// 【保存失敗をlibwebpの一般的な書き込みエラーへ置き換えず、元の原因を返して資源を解放する】
// ディスク不足や中断の理由を失うと対処できず、失敗したエンコーダーを再利用すると破損につながる。
test('propagates writer failures and closes the encoder', async () => {
	const encoder = await prepare(7, 5, pixelsFor(7, 5));
	const error = new Error('disk full');
	await assert.rejects(encoder.encode(async () => { throw error; }), value => value === error);
	assert.throws(() => encoder.writeBlock(new Uint8Array(1)), /closed/);
	encoder.dispose();
});

// 【入力不足・形式上限超過・不正な品質を、圧縮や大きな確保の前に拒否する】
// nativeへ不完全な入力を渡すと、未初期化の画素を成功した画像として出力する可能性がある。
test('rejects invalid dimensions, quality, and incomplete rows', async () => {
	for (const options of [{ width: 0, height: 1 }, { width: 16384, height: 1 }, { width: 1, height: 1, quality: NaN }]) {
		await assert.rejects(WebpEncoder.create({ lossless: true, quality: 75, ...options }, wasmBinary), /Invalid WebP/);
	}
	const encoder = await WebpEncoder.create({ width: 3, height: 2, lossless: true, quality: 75 }, wasmBinary);
	try {
		assert.throws(() => encoder.writeBlock(new Uint8Array(1)), /Invalid WebP pixel block/);
		await assert.rejects(encoder.encode(async () => {}), /incomplete/);
	} finally { encoder.dispose(); }
});

// 【配布するWASMそのものがWASM32の4GiBまで成長できることを確認する】
// JSの設定やビルドスクリプトだけ直しても、古い2GiB制限のバイナリーを配布すると再発する。
// 巨大なメモリを通常テストで確保せず、標準のmemory sectionの宣言を調べる。
test('ships a wasm32 memory with a four GiB maximum', () => {
	let position = 8;
	const integer = () => {
		let value = 0, shift = 0, byte;
		do { byte = bytes[position++]; value += (byte & 127) * 2 ** shift; shift += 7; } while ((byte & 128) !== 0);
		return value;
	};
	while (position < bytes.length) {
		const section = bytes[position++];
		const size = integer();
		const end = position + size;
		if (section === 5) {
			assert.equal(integer(), 1);
			assert.equal(integer(), 1, '32-bit memory with an explicit maximum');
			integer();
			assert.equal(integer() * 65536, 4 * 1024 ** 3);
			return;
		}
		position = end;
	}
	assert.fail('WASM memory declaration was not found');
});

// 【明示実行時に16383角の画像を行ブロックで取り込み、全画素の可逆性を確認する】
// 通常テストで数GiBのRAMを占有せず、形式上限における整数アドレス・行数・出力寸法を検証する。
// 単色でもWASMは4GiB近くまで成長するため、実行環境に余裕がある場合だけ有効にする。
test('round-trips a full 16383 square image without a whole JavaScript input array',
	{ skip: process.env.LARGE_WEBP_CODEC_TEST !== '1', timeout: 120000 }, async () => {
		const width = 16383, height = 16383;
		const encoder = await WebpEncoder.create({ width, height, lossless: true, quality: 75 }, wasmBinary);
		const block = new Uint8Array(width * encoder.rowsPerBlock * 4);
		for (let index = 0; index < block.length; index += 4) block.set([17, 83, 157, 255], index);
		const expected = createHash('sha256');
		try {
			for (let row = 0; row < height; row += encoder.rowsPerBlock) {
				const pixels = block.subarray(0, width * Math.min(encoder.rowsPerBlock, height - row) * 4);
				expected.update(pixels);
				encoder.writeBlock(pixels);
			}
			const result = await decode(await collect(encoder));
			assert.deepEqual([result.width, result.height], [width, height]);
			assert.equal(createHash('sha256').update(result.data).digest('hex'), expected.digest('hex'));
		} finally { encoder.dispose(); }
	});
