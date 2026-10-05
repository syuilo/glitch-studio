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
	const reader = new AssetAudioReader([asset], { open: async resolved => {
		opened.push(resolved);
		return { durationSeconds: 1, sampleRate: 1000, dispose() { disposed++; },
			async *readBlocks() {
				yield { time: 0, rate: 1000, channels: [
					Float32Array.from({ length: 1000 }, (_, frame) => frame / 1000),
					Float32Array.from({ length: 1000 }, (_, frame) => -frame / 1000),
				] };
			},
		};
	} });
	try {
		const pcm = await reader.read('sound', 0.5, 3, 1000);
		assert.deepEqual(pcm, [Float32Array.of(0.5, 0.501, 0.502), Float32Array.of(-0.5, -0.501, -0.502)]);
		await reader.read('sound', 0.6, 3, 1000);
		assert.deepEqual(opened, [asset]);
	} finally { reader.dispose(); }
	assert.equal(disposed, 1);
});

// 【参照切れのAssetをデコーダーへ渡さず、呼び出し元へエラーを返す】
// 参照切れを無音に置き換えて成功扱いにせず、ソースを開く前に拒否する。
test('rejects missing assets before opening audio', async () => {
	let opened = 0;
	const reader = new AssetAudioReader([], { open: async () => { opened++; throw new Error('unexpected open'); } });
	try {
		await assert.rejects(reader.read('missing', 0, 10, 48000), /Audio asset not found: missing/);
		assert.equal(opened, 0);
	} finally { reader.dispose(); }
});

// 【Assetのラッパーでも呼び出し側のキャンセルをPCM読み出しへ伝える】
// 読み出しAPIにSignalを追加しても、アプリ側の境界で落とすと中断済みの素材取得が続いてしまう。
test('forwards cancellation before resolving the asset', async () => {
	let opened = 0;
	const reader = new AssetAudioReader([{ id: 'sound' }], { open: async () => { opened++; throw new Error('unexpected open'); } });
	const controller = new AbortController();
	controller.abort();
	try {
		await assert.rejects(reader.read('sound', 0, 10, 48000, controller.signal), { name: 'AbortError' });
		assert.equal(opened, 0);
	} finally { reader.dispose(); }
});
