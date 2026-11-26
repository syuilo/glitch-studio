import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

function readWebp(base64) {
	const bytes = Buffer.from(base64, 'base64');
	assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
	assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
	const chunks = new Map();
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = bytes.readUInt32LE(offset + 4);
		chunks.set(bytes.toString('ascii', offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
		offset += 8 + size + (size % 2);
	}
	const lossy = chunks.get('VP8 ');
	assert.ok(lossy, 'expected a lossy VP8 payload');
	assert.deepEqual([lossy.readUInt16LE(6) & 0x3fff, lossy.readUInt16LE(8) & 0x3fff], [300, 200]);
	return { hasAlpha: chunks.has('ALPH') };
}

// 【Native Effect のサムネイルで、画像の接続方法とパラメータが描画へ反映され、黒背景で保存される】
// 定義の省略と明示的な未接続を区別し、完全透明と半透明の出力を、
// 黒に合成済みの不透明色と同じ WebP にできることを確かめる。
test('renders opaque lossy WebP thumbnails with sample connections and parameter overrides',
	{ skip: process.env.CHROME_PATH == null, timeout: 90_000 }, async () => {
		const slideInputs = { inputA: 'sceneA', inputB: 'sceneB' };
		const requests = [
			{ id: 'vignette', thumbnail: { mode: 'defaultParameters' } },
			{ id: 'vignette', thumbnail: { mode: 'defaultParameters', inputs: { input: 'sceneA' } } },
			{ id: 'vignette', thumbnail: { mode: 'defaultParameters', inputs: {} } },
			{ id: 'fill', thumbnail: { mode: 'customParameters', params: { color: [0, 0, 0, 1] } } },
			{ id: 'fill', thumbnail: { mode: 'customParameters', params: { color: [1, 0, 0, 0.5] } } },
			{ id: 'fill', thumbnail: { mode: 'customParameters', params: { color: [0.5, 0, 0, 1] } } },
			{ id: 'slideTransition', thumbnail: { mode: 'defaultParameters', inputs: slideInputs } },
			{ id: 'slideTransition', thumbnail: { mode: 'customParameters', inputs: slideInputs, params: { progress: 0.5 } } },
			{ id: 'slideTransition', thumbnail: { mode: 'customParameters', inputs: { inputA: 'sceneA', inputB: 'sceneA' }, params: { progress: 0.5 } } },
		];
		const results = await runEffectGpuTest(new URL('../tools/render-thumbnails.ts', import.meta.url), 'renderThumbnails', 75_000, [requests]);
		assert.deepEqual(results.map(result => result.id), requests.map(request => request.id));
		for (const result of results) assert.equal(result.error, undefined, result.error);
		const [implicit, explicit, disconnected, black, translucentRed, redOnBlack, initialSlide, halfwaySlide, sameImageSlide] = results.map(result => result.base64);
		assert.equal(implicit, explicit);
		assert.notEqual(implicit, disconnected);
		assert.equal(disconnected, black);
		assert.equal(translucentRed, redOnBlack);
		assert.notEqual(initialSlide, halfwaySlide);
		assert.notEqual(halfwaySlide, sameImageSlide);
		for (const result of results) assert.deepEqual(readWebp(result.base64), { hasAlpha: false });
	});
