import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { AssetTextures } = await loadShaderSource(fileURLToPath(new URL('../src/asset-textures.ts', import.meta.url)));
const asset = (id, type = 'image/png') => ({ id, name: id, width: 4, height: 2, fileDataType: type, fileData: new Blob([id], { type }) });
const bitmap = () => ({ width: 4, height: 2, closed: 0, close() { this.closed++; } });

function fixture(t, assets) {
	const requests = [], textures = [], copies = [];
	const originalDecode = globalThis.createImageBitmap;
	const originalUsage = globalThis.GPUTextureUsage;
	globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
	globalThis.createImageBitmap = blob => {
		const request = { blob, ...Promise.withResolvers() };
		requests.push(request);
		return request.promise;
	};
	const device = {
		createTexture(options) {
			const texture = { ...options, destroyed: 0, destroy() { this.destroyed++; } };
			textures.push(texture);
			return texture;
		},
		queue: { copyExternalImageToTexture(...args) { copies.push(args); } },
	};
	const store = new AssetTextures(device, assets);
	t.after(() => {
		store.dispose();
		if (originalDecode != null) globalThis.createImageBitmap = originalDecode;
		else delete globalThis.createImageBitmap;
		if (originalUsage != null) globalThis.GPUTextureUsage = originalUsage;
		else delete globalThis.GPUTextureUsage;
	});
	return { store, device, requests, textures, copies };
}

// 【初期素材を順番に準備し、全画像のアップロード完了でreadyを解決する】
// ManagerはこのPromiseの完了後だけ描画を開始する。大きな画像を同時にデコードせず、
// Bitmapの解放とpremultiply指定も初期化境界で保証する。
test('prepares the fixed image assets sequentially before becoming ready', async t => {
	const f = fixture(t, [asset('first'), asset('audio', 'audio/wav'), asset('second')]);
	let ready = false;
	void f.store.ready.then(() => { ready = true; });
	assert.equal(f.requests.length, 1);
	const first = bitmap();
	f.requests[0].resolve(first);
	await Promise.resolve();
	assert.equal(ready, false);
	assert.equal(f.requests.length, 2);
	const second = bitmap();
	f.requests[1].resolve(second);
	await f.store.ready;
	assert.equal(ready, true);
	assert.deepEqual([...f.store.textures.keys()], ['first', 'second']);
	assert.equal(first.closed, 1);
	assert.equal(second.closed, 1);
	assert.ok(f.copies.every(([, destination]) => destination.premultipliedAlpha === true));
});

for (const failure of ['decode', 'upload']) {
	// 【初期化の失敗では、先に転送した画像と失敗途中の画像をすべて解放する】
	// 旧素材を維持する更新処理は持たず、失敗したインスタンスのGPU資源を残さない。
	test(`releases partial initialization resources on ${failure} failure`, async t => {
		const f = fixture(t, [asset('first'), asset('second')]);
		const rejected = assert.rejects(f.store.ready, /failed/);
		f.requests[0].resolve(bitmap());
		await Promise.resolve();
		const last = bitmap();
		if (failure === 'decode') f.requests[1].reject(new Error('decode failed'));
		else {
			f.device.queue.copyExternalImageToTexture = () => { throw new Error('upload failed'); };
			f.requests[1].resolve(last);
		}
		await rejected;
		assert.equal(f.store.textures.size, 0);
		assert.ok(f.textures.every(texture => texture.destroyed === 1));
		if (failure === 'upload') assert.equal(last.closed, 1);
	});
}

// 【破棄後に完了したデコードはGPUを使用せず、遅れて届いたBitmapだけ閉じる】
// 素材変更や書き出し開始でWorkerを破棄できても、createImageBitmap自体は中断できない。
// 部分的に転送した資源と、非同期処理の完了後に得られる資源をそれぞれ解放する。
test('disposes partial resources and ignores a late decode after destruction', async t => {
	const f = fixture(t, [asset('first'), asset('second')]);
	f.requests[0].resolve(bitmap());
	await Promise.resolve();
	f.store.dispose();
	assert.equal(f.textures[0].destroyed, 1);
	const late = bitmap();
	f.requests[1].resolve(late);
	await f.store.ready;
	assert.equal(late.closed, 1);
	assert.equal(f.textures.length, 1);
	assert.equal(f.store.textures.size, 0);
});

// 【破棄済みインスタンスのデコード失敗を、新しい素材の失敗として扱わない】
// 次のManagerが正常に準備できても、古い非同期処理の失敗は遅れて届き得る。
test('ignores a decoding failure after disposal', async t => {
	const f = fixture(t, [asset('removed')]);
	f.store.dispose();
	f.requests[0].reject(new Error('obsolete decode failed'));
	await f.store.ready;
	assert.equal(f.textures.length, 0);
});
