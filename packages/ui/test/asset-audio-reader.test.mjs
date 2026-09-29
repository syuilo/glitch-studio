import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['./src/audio/asset-audio-reader.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { AssetAudioReader } = module.exports;

function wav(rate = 8000, valueAt = () => 0.25, seconds = 3) {
	const frames = rate * seconds;
	const buffer = new ArrayBuffer(44 + frames * 2);
	const data = new DataView(buffer);
	const text = (offset, value) => [...value].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)));
	text(0, 'RIFF'); data.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
	data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
	data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
	text(36, 'data'); data.setUint32(40, frames * 2, true);
	for (let i = 0; i < frames; i++) data.setInt16(44 + i * 2, Math.round(valueAt(i / rate) * 32768), true);
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

// 【実際のWAV読み取りでも、時間窓の前後にフィルター用のPCMを確保する】
// リサンプラー単体が正しくても、窓の余白不足は周期的なクリック音や境界の減衰を生む。
test('filters decoded WAV audio consistently across cache boundaries and seeks', async () => {
	const reader = new AssetAudioReader([wav(96000, time => 0.25 * Math.sin(2 * Math.PI * 1000 * time) + 0.25 * Math.sin(2 * Math.PI * 30000 * time))]);
	try {
		const whole = await reader.read('wav', 1.99, 960, 48000);
		const split = await reader.read('wav', 2, 480, 48000);
		for (let i = 0; i < 960; i++) {
			const expected = 0.25 * Math.sin(2 * Math.PI * 1000 * (1.99 + i / 48000));
			assert.ok(Math.abs(whole[0][i] - expected) < 0.0001, `frame ${i}`);
		}
		assert.deepEqual(whole[0].slice(480), split[0]);
	} finally { reader.dispose(); }
});

function decodedSource() {
	const calls = [];
	let disposed = 0;
	return { calls, get disposed() { return disposed; }, async open() {
		return { duration: 20, sampleRate: 1000, input: { dispose() { disposed++; } }, sink: {
			async *samples(start, end) {
				calls.push([start, end]);
				const first = Math.floor(start * 1000);
				yield { timestamp: first / 1000, sampleRate: 1000, numberOfFrames: Math.ceil(end * 1000) - first,
					numberOfChannels: 1, copyTo(target) { target.fill(0.25); }, close() {} };
			},
		} };
	} };
}

// 【同じ素材の離れた再生位置でデコード窓を奪い合わない】
// 重なったレイヤーを交互に読んでも、保持済みの窓を毎フレームデコードし直さない。
test('reuses windows for overlapping layers at different source offsets', async () => {
	const source = decodedSource();
	const reader = new AssetAudioReader([{ id: 'asset' }], { open: source.open });
	try {
		for (let i = 0; i < 30; i++) {
			for (const offset of [0.1, 4.1]) {
				const output = await reader.read('asset', offset + i / 30, 33, 1000);
				assert.ok(output[0].every(value => value === 0.25));
			}
		}
		assert.equal(source.calls.length, 2);
	} finally { reader.dispose(); }
	assert.equal(source.disposed, 1);
});

// 【キャッシュ上限は全素材に適用し、最近使った窓を優先する】
// 素材数や読み取り位置が増えてもメモリが増え続けず、追い出した窓だけ再デコードする。
test('evicts the least recently used window within a shared byte budget', async () => {
	const source = decodedSource();
	// 1窓は前後の余白を含めて約17KBなので、2窓だけ保持できる。
	const reader = new AssetAudioReader([{ id: 'a' }, { id: 'b' }], { open: source.open, maxCacheBytes: 34000 });
	try {
		await reader.read('a', 0.1, 10, 1000);
		await reader.read('b', 4.1, 10, 1000);
		await reader.read('a', 0.2, 10, 1000);
		await reader.read('a', 8.1, 10, 1000);
		assert.equal(source.calls.length, 3);
		await reader.read('a', 0.3, 10, 1000);
		assert.equal(source.calls.length, 3);
		await reader.read('b', 4.2, 10, 1000);
		assert.equal(source.calls.length, 4);
	} finally { reader.dispose(); }
});
