import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import encode, { init as initEncode } from '@jsquash/webp/encode.js';
import decode, { init as initDecode } from '@jsquash/webp/decode.js';
import { getWebpOptions } from '../src/export/webp-options.ts';

const require = createRequire(import.meta.url);

// Canvas品質1.0をロスレスと誤認しないよう、実際のWASMで符号化・復号して画素の一致を確認する。
test('encodes lossless WebP preserving RGBA including transparent pixel colors', async t => {
	const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
	const originalImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
	globalThis.self = globalThis;
	globalThis.ImageData = class {
		constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
	};
	t.after(() => {
		if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
		else delete globalThis.self;
		if (originalImageData) Object.defineProperty(globalThis, 'ImageData', originalImageData);
		else delete globalThis.ImageData;
	});
	// NodeではHTTP取得せず、選ばれたSIMD版/通常版をローカルから初期化する。
	const { simd } = createRequire(require.resolve('@jsquash/webp/encode.js'))('wasm-feature-detect');
	const encoderName = await simd() ? 'webp_enc_simd.wasm' : 'webp_enc.wasm';
	await initEncode({ wasmBinary: await readFile(require.resolve(`@jsquash/webp/codec/enc/${encoderName}`)) });
	await initDecode({ wasmBinary: await readFile(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')) });
	const pixels = new Uint8ClampedArray([
		255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0,
		15, 77, 120, 255, 190, 42, 67, 64, 255, 255, 255, 255,
	]);
	const input = new ImageData(pixels, 3, 2);
	const encoded = await encode(input, getWebpOptions('lossless'));
	assert.equal(new TextDecoder().decode(encoded.slice(0, 4)), 'RIFF');
	assert.equal(new TextDecoder().decode(encoded.slice(8, 12)), 'WEBP');
	const output = await decode(encoded);
	assert.equal(output.width, 3);
	assert.equal(output.height, 2);
	assert.deepEqual(output.data, pixels);
	const lossy = await decode(await encode(input, getWebpOptions('high')));
	assert.deepEqual(Array.from(lossy.data).filter((_, index) => index % 4 === 3), [255, 128, 0, 255, 64, 255]);
});
