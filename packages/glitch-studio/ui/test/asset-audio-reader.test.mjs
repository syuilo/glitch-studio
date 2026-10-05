import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/audio/asset-audio-reader.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { AssetAudioReader } = module.exports;

// 【Assetの解決はアプリ側で行い、デコード資源はreaderの寿命に合わせて解放する】
// subsystemへAsset一覧を移さなくても、同じ素材の長さ取得・PCM読み出しで
// 同じデコーダーを再利用し、左右のチャンネルと読み出し位置を維持する必要がある。
test('resolves asset identities and delegates PCM reads and resource ownership', async () => {
	const asset = { id: 'sound', name: 'Sound.wav', fileData: new Blob() };
	const opened = [];
	let disposed = 0;
	let closed = 0;
	const reader = new AssetAudioReader([asset], { open: async resolved => {
		opened.push(resolved);
		return { duration: 1, sampleRate: 1000, input: { dispose() { disposed++; } }, sink: {
			async *samples() {
				yield { timestamp: 0, sampleRate: 1000, numberOfFrames: 1000, numberOfChannels: 2,
					copyTo(target, { planeIndex }) { target.set(Float32Array.from({ length: 1000 }, (_, frame) => (planeIndex === 0 ? 1 : -1) * frame / 1000)); },
					close() { closed++; } };
			},
		} };
	} });
	try {
		assert.equal(await reader.getDurationMs('sound'), 1000);
		const pcm = await reader.read('sound', 0.5, 3, 1000);
		assert.deepEqual(pcm, [Float32Array.of(0.5, 0.501, 0.502), Float32Array.of(-0.5, -0.501, -0.502)]);
		assert.equal(await reader.getDurationMs('sound'), 1000);
		assert.deepEqual(opened, [asset]);
		assert.equal(closed, 1);
	} finally { reader.dispose(); }
	assert.equal(disposed, 1);
});

// 【参照切れのAssetをデコーダーへ渡さず、呼び出し元へエラーを返す】
// 音声用と動画の素材長用のどちらも、無音や長さ0に置き換えて成功扱いにしない。
test('rejects missing assets before opening audio or reading media metadata', async () => {
	let opened = 0;
	const reader = new AssetAudioReader([], { open: async () => { opened++; throw new Error('unexpected open'); } });
	try {
		await assert.rejects(reader.read('missing', 0, 10, 48000), /Audio asset not found: missing/);
		await assert.rejects(reader.getDurationMs('missing'), /Audio asset not found: missing/);
		await assert.rejects(reader.getDurationMs('missing', 'media'), /Media asset not found: missing/);
		assert.equal(opened, 0);
	} finally { reader.dispose(); }
});
