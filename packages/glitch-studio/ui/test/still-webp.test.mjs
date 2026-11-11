import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/export/still-webp.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'webp-input-boundary', setup(build) {
		build.onResolve({ filter: /^@gs\/subsystems_image-codec\/webp-encoder\.ts$/ }, args => ({ path: args.path, namespace: 'codec' }));
		build.onLoad({ filter: /.*/, namespace: 'codec' }, () => ({ contents: 'export const WebpEncoder = { create: options => dependencies.create(options) };' }));
	} }],
});

function fixture() {
	const blocks = [];
	let options = null;
	let disposed = false;
	const encoder = { rowsPerBlock: 2, writeBlock: block => blocks.push(block), dispose: () => { disposed = true; } };
	const context = { module: { exports: {} }, dependencies: { async create(value) { options = value; return encoder; } } };
	runInNewContext(bundled.outputFiles[0].text, context);
	return { prepare: context.module.exports.prepareStillWebp, blocks, encoder,
		get options() { return options; }, get disposed() { return disposed; } };
}

// 【Canvasや全画像配列を要求せず、sRGBの行ブロックをそのままコーデックへ渡す】
// 画像読み戻しとコーデックの境界で全画像を再構築すると、16Kでは約1GiBの余分なコピーが生じる。
test('prepares the WebP encoder directly from sRGB blocks', async () => {
	const f = fixture();
	const blocks = [new Uint8Array(24), new Uint8Array(12)];
	const controller = new AbortController();
	const image = { width: 3, height: 3, async *readBlocks(rows, signal) {
		assert.equal(rows, 2);
		assert.equal(signal, controller.signal);
		yield* blocks;
	} };
	assert.equal(await f.prepare(image, { quality: 'lossless' }, controller.signal), f.encoder);
	assert.deepEqual(structuredClone(f.options), { width: 3, height: 3, lossless: true, quality: 75 });
	assert.equal(f.blocks[0], blocks[0]);
	assert.equal(f.blocks[1], blocks[1]);
	assert.equal(f.disposed, false);
});

// 【GPU読み戻しや中断の失敗で、取り込み途中のWASM画像を必ず解放する】
// 圧縮が始まらなかった場合も、1GiBに達し得る画像領域を次の試行まで残さない。
test('disposes incomplete WebP input after readback failure or cancellation', async () => {
	for (const abort of [false, true]) {
		const f = fixture();
		const controller = new AbortController();
		const failure = new Error('readback failed');
		const image = { width: 3, height: 3, async *readBlocks() {
			yield new Uint8Array(24);
			if (abort) { controller.abort(); controller.signal.throwIfAborted(); }
			throw failure;
		} };
		await assert.rejects(f.prepare(image, { quality: 'high' }, controller.signal),
			value => abort ? value.name === 'AbortError' : value === failure);
		assert.equal(f.disposed, true);
		assert.equal(f.blocks.length, 1);
	}
});
