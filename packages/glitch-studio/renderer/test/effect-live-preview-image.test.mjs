import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { EffectLivePreviewImage } = await loadShaderSource(fileURLToPath(new URL('../src/effect-live-preview-image.ts', import.meta.url)));

function fixture(t) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'GPUTextureUsage');
	globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
	t.after(() => {
		if (previous != null) Object.defineProperty(globalThis, 'GPUTextureUsage', previous);
		else delete globalThis.GPUTextureUsage;
	});
	const calls = { copies: [], textures: [], submissions: 0 };
	const device = {
		createShaderModule: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createBindGroup: () => ({}),
		createTexture({ size }) {
			const texture = { width: size[0], height: size[1], destroyed: 0, createView: () => ({}), destroy() { this.destroyed++; } };
			calls.textures.push(texture);
			return texture;
		},
		createCommandEncoder: () => ({ beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }), finish: () => ({}) }),
		queue: { copyExternalImageToTexture: ({ source }) => calls.copies.push(source), submit() { calls.submissions++; } },
	};
	const textures = new EffectLivePreviewImage(device);
	t.after(() => textures.dispose());
	const frame = (width = 16, height = 9) => ({ codedWidth: width, codedHeight: height, displayWidth: width, displayHeight: height,
		timestamp: 0, closed: 0, close() { this.closed++; } });
	return { textures, calls, device, frame };
}

// 【複数ノードとFit変更は同じ正規化画像を借り、未使用の画像は変換しない】
// ノード側の描画キャッシュだけでは、同じ入力を参照する別ノードのGPU転送が重複する。
test('normalizes a preview frame once and reuses its textures across frame updates', t => {
	const { textures, calls, frame } = fixture(t);
	const first = frame();
	textures.update(first, null);
	assert.equal(calls.textures.length, 0);
	const image = textures.bind().texture;
	assert.equal(textures.bind().texture, image);
	assert.deepEqual(textures.bind().resolution, { width: 16, height: 9 });
	assert.deepEqual(calls.copies, [first]);
	assert.equal(calls.submissions, 1);
	assert.equal(calls.textures.length, 2);
	const next = frame();
	textures.update(next, null);
	assert.equal(first.closed, 1);
	assert.equal(textures.bind().version, 2);
	const updated = textures.bind().texture;
	assert.equal(updated, image);
	assert.equal(textures.bind().texture, updated);
	assert.deepEqual(calls.copies, [first, next]);
	assert.equal(calls.textures.length, 2);
	assert.equal(next.closed, 0);
});

// 【フレーム消失・再追加・破棄で古い映像を返さず、借用元のフレームとGPU資源を解放する】
// 参照しているノード数と入力の寿命を分け、ノード破棄に共有画像の所有権を持たせない。
test('releases removed preview frames and keeps versions monotonic after recovery', t => {
	const { textures, calls, frame } = fixture(t);
	const first = frame();
	textures.update(first, null);
	textures.bind().texture;
	textures.update(null, null);
	assert.equal(first.closed, 1);
	assert.ok(calls.textures.every(texture => texture.destroyed === 1));
	assert.equal(textures.bind().texture.width, 1);
	const next = frame(32, 18);
	textures.update(next, null);
	assert.equal(textures.bind().version, 3);
	assert.deepEqual(textures.bind().resolution, { width: 32, height: 18 });
	textures.dispose();
	assert.equal(next.closed, 1);
	assert.ok(calls.textures.every(texture => texture.destroyed === 1));
});

// 【転送失敗を正規化済みとしてキャッシュせず、再試行と破棄を可能にする】
// 部分初期化したテクスチャを後続ノードへ正常画像として渡すことを防ぐ。
test('retries failed normalization without caching partial results', t => {
	const { textures, calls, device, frame } = fixture(t);
	const first = frame();
	textures.update(first, null);
	const copy = device.queue.copyExternalImageToTexture;
	device.queue.copyExternalImageToTexture = () => { throw new Error('copy failed'); };
	assert.throws(() => textures.bind().texture, /copy failed/);
	device.queue.copyExternalImageToTexture = copy;
	assert.notEqual(textures.bind().texture, null);
	assert.deepEqual(calls.copies, [first]);
	assert.equal(calls.textures.length, 2);
});
