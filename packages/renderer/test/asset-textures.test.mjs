import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { AssetTextures } = await loadShaderSource(fileURLToPath(new URL('../src/asset-textures.ts', import.meta.url)));

function asset(id, type = 'image/png') {
	return { id, name: id, width: 4, height: 2, fileDataType: type, fileData: new Blob([id], { type }) };
}

function bitmap() {
	return { width: 4, height: 2, closed: 0, close() { this.closed++; } };
}

function fixture(t) {
	const requests = [];
	const textures = [];
	const copies = [];
	const originalDecode = globalThis.createImageBitmap;
	const originalUsage = globalThis.GPUTextureUsage;
	globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
	globalThis.createImageBitmap = blob => {
		const request = { blob, ...Promise.withResolvers() };
		requests.push(request);
		return request.promise;
	};
	t.after(() => {
		if (originalDecode) globalThis.createImageBitmap = originalDecode;
		else delete globalThis.createImageBitmap;
		if (originalUsage) globalThis.GPUTextureUsage = originalUsage;
		else delete globalThis.GPUTextureUsage;
	});
	const device = {
		createTexture(descriptor) {
			const texture = { descriptor, destroyed: 0, destroy() { this.destroyed++; } };
			textures.push(texture);
			return texture;
		},
		queue: { copyExternalImageToTexture(...args) { copies.push(args); } },
	};
	const store = new AssetTextures(device);
	t.after(() => store.dispose());
	async function load(id = 'old') {
		const pending = store.update([asset(id)], () => {});
		requests.at(-1).resolve(bitmap());
		await pending;
		return store.textures.get(id);
	}
	return { store, requests, textures, copies, device, load };
}

// 全画像が準備できるまで旧表示を維持し、MapとAsset一覧を同じタイミングで切り替える。
// 途中の画像だけ公開すると、新旧の素材が混在したフレームや一時的な透明表示が発生する。
// また、Mapを交換すると既存のVisualModuleRendererが旧Mapを参照し続けるため、参照自体も維持する。
test('publishes a complete texture set atomically and closes decoded images', async t => {
	const f = fixture(t);
	const old = await f.load();
	const map = f.store.textures;
	let committed = false;
	const images = [asset('a'), asset('b'), asset('font', 'font/ttf')];
	const update = f.store.update(images, () => {
		committed = true;
		assert.deepEqual([...map.keys()], ['a', 'b']);
		assert.equal(old.destroyed, 0);
	});
	const first = bitmap();
	f.requests.at(-1).resolve(first);
	await Promise.resolve();
	assert.equal(first.closed, 1);
	assert.equal(committed, false);
	assert.equal(map.get('old'), old);
	const second = bitmap();
	f.requests.at(-1).resolve(second);
	assert.equal(await update, true);
	assert.equal(second.closed, 1);
	assert.equal(f.store.textures, map);
	assert.equal(old.destroyed, 1);
	assert.equal(f.requests.length, 3);
	assert.equal(f.requests[1].blob, images[0].fileData);
	assert.equal(f.copies[1][1].premultipliedAlpha, true);
});

// 差し替え完了後に旧デコードが戻っても、最新のAssetを上書きしない。
// デコードの完了順は操作順と一致しない。重い画像から軽い画像へ差し替えると、
// 古い要求が最後に完了して画面が元に戻り得るため、最新の更新だけを公開する。
test('discards an older update that completes after its replacement', async t => {
	const f = fixture(t);
	const first = f.store.update([asset('same')], () => assert.fail('stale commit'));
	const oldRequest = f.requests.at(-1);
	await f.load('same');
	const current = f.store.textures.get('same');
	const obsolete = bitmap();
	oldRequest.resolve(obsolete);
	assert.equal(await first, false);
	assert.equal(obsolete.closed, 1);
	assert.equal(f.store.textures.get('same'), current);
	assert.equal(f.textures.length, 1);
});

// 削除はデコードを待たずに反映し、既に準備した途中のテクスチャも解放する。
// 削除されたAssetの読み込みを継続すると、削除後に画像が復活したりGPUメモリが残ったりする。
// 複数画像のうち一部だけGPUへ転送済みの状態でも、取り消した要求の所有物を解放する必要がある。
test('deletes assets during a partially prepared update', async t => {
	const f = fixture(t);
	const old = await f.load();
	const update = f.store.update([asset('a'), asset('b')], () => assert.fail('stale commit'));
	f.requests.at(-1).resolve(bitmap());
	await Promise.resolve();
	const partial = f.textures.at(-1);
	await f.store.update([], () => {});
	assert.equal(old.destroyed, 1);
	const late = bitmap();
	f.requests.at(-1).resolve(late);
	assert.equal(await update, false);
	assert.equal(partial.destroyed, 1);
	assert.equal(late.closed, 1);
	assert.equal(f.store.textures.size, 0);
});

// デコード失敗・アップロード失敗のどちらも、途中のリソースだけを捨て旧表示を保つ。
// 一つの不正な画像で、それまで描画できていた素材まで失われてはいけない。
// 失敗をUIへ返すと同時に、先に成功した画像や転送途中のテクスチャのリークも防ぐ。
for (const failure of ['decode', 'upload']) {
	test(`preserves the old assets and releases partial resources on ${failure} failure`, async t => {
		const f = fixture(t);
		const old = await f.load();
		const update = f.store.update([asset('a'), asset('b')], () => assert.fail('failed commit'));
		const rejected = assert.rejects(update, /failed/);
		f.requests.at(-1).resolve(bitmap());
		await Promise.resolve();
		const last = bitmap();
		if (failure === 'decode') f.requests.at(-1).reject(new Error('decode failed'));
		else {
			f.device.queue.copyExternalImageToTexture = () => { throw new Error('upload failed'); };
			f.requests.at(-1).resolve(last);
		}
		await rejected;
		assert.equal(f.store.textures.get('old'), old);
		assert.equal(old.destroyed, 0);
		assert.ok(f.textures.slice(1).every(texture => texture.destroyed === 1));
		if (failure === 'upload') assert.equal(last.closed, 1);
	});
}

// レンダラー破棄後にはGPUリソースを生成せず、遅れて届いたImageBitmapだけを閉じる。
// createImageBitmapの待機はレンダラー破棄で自動的に中止されない。
// 完了後に破棄済みGPUDeviceを使ったり、デコード済み画像を閉じ忘れたりしないことを保証する。
test('disposes active textures and ignores pending decodes after destruction', async t => {
	const f = fixture(t);
	const old = await f.load();
	const update = f.store.update([asset('new')], () => assert.fail('disposed commit'));
	f.store.dispose();
	const late = bitmap();
	f.requests.at(-1).resolve(late);
	assert.equal(await update, false);
	assert.equal(old.destroyed, 1);
	assert.equal(late.closed, 1);
	assert.equal(f.textures.length, 1);
	assert.equal(await f.store.update([], () => assert.fail('disposed commit')), false);
});

// 既に取り消された要求の失敗は、新しいAssetのエラーとして通知しない。
// ユーザーが問題の画像を削除・差し替え済みでも、古い読み込みから遅れて例外が届き得る。
// その例外で現在の正常な操作を失敗扱いにしないよう、不要になった要求の失敗を無視する。
test('ignores a decoding failure after the assets have been removed', async t => {
	const f = fixture(t);
	const update = f.store.update([asset('removed')], () => assert.fail('stale commit'));
	await f.store.update([], () => {});
	f.requests[0].reject(new Error('obsolete decode failed'));
	assert.equal(await update, false);
});
