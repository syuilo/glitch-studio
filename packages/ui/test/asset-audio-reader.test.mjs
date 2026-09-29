import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['./src/audio/asset-audio-reader.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { AssetAudioReader } = module.exports;

function wav() {
	const rate = 8000;
	const frames = rate * 3;
	const buffer = new ArrayBuffer(44 + frames * 2);
	const data = new DataView(buffer);
	const text = (offset, value) => [...value].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)));
	text(0, 'RIFF'); data.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
	data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
	data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
	text(36, 'data'); data.setUint32(40, frames * 2, true);
	for (let i = 0; i < frames; i++) data.setInt16(44 + i * 2, 8192, true);
	return { id: 'wav', name: 'Test.wav', fileDataType: 'audio/wav', fileData: new Blob([buffer]) };
}

// 【実際のWAVデコードと窓境界の再サンプリングを確認する】
// デコーダーのtimestamp・PCMコピー規約の取り違えは、モックでは検出できない。
test('decodes mono PCM, duplicates channels and resamples across cache windows', async () => {
	const reader = new AssetAudioReader([wav()]);
	try {
		const output = await reader.read('wav', 1.99, 960, 48000);
		assert.equal(output[0].length, 960);
		assert.ok(output[0].every(value => Math.abs(value - 0.25) < 0.0001));
		assert.deepEqual(output[0], output[1]);
		const silence = await reader.read('wav', 3.1, 128, 44100);
		assert.ok(silence[0].every(value => value === 0));
		const sought = await reader.read('wav', 0.5, 128, 44100);
		assert.ok(sought[0].every(value => Math.abs(value - 0.25) < 0.0001));
	} finally { reader.dispose(); }
});
