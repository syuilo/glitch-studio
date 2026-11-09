import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { PlayerVideoTextures } = await loadShaderSource(fileURLToPath(new URL('../src/player-video-textures.ts', import.meta.url)));

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
	const textures = new PlayerVideoTextures(device);
	t.after(() => textures.dispose());
	const frame = (width = 16, height = 9) => ({ codedWidth: width, codedHeight: height, displayWidth: width, displayHeight: height,
		timestamp: 0, closed: 0, close() { this.closed++; } });
	return { textures, calls, device, frame };
}

// 【複数ノードとFit変更は同じ正規化画像を借り、未使用Playerは変換しない】
// ノード側の描画キャッシュだけでは、同じPlayerを参照する別ノードのGPU転送が重複する。
test('normalizes a player frame once and reuses its textures across frame updates', t => {
	const { textures, calls, frame } = fixture(t);
	const first = frame();
	const unused = frame();
	textures.updateFrame('player', first);
	textures.updateFrame('unused', unused);
	assert.equal(calls.textures.length, 0);
	const image = textures.getTexture('player');
	assert.equal(textures.getTexture('player'), image);
	assert.deepEqual(image.displayResolution, { width: 16, height: 9 });
	assert.deepEqual(calls.copies, [first]);
	assert.equal(calls.submissions, 1);
	assert.equal(calls.textures.length, 2);
	const next = frame();
	textures.updateFrame('player', next);
	assert.equal(first.closed, 1);
	assert.equal(textures.frameVersions.get('player'), 2);
	const updated = textures.getTexture('player');
	assert.equal(updated.texture, image.texture);
	assert.equal(textures.getTexture('player'), updated);
	assert.deepEqual(calls.copies, [first, next]);
	assert.equal(calls.textures.length, 2);
	assert.equal(next.closed, 0);
	assert.equal(unused.closed, 0);
});

// 【フレーム消失・再追加・破棄で古い映像を返さず、借用元のフレームとGPU資源を解放する】
// 参照しているノード数とPlayerの寿命を分け、ノード破棄に共有画像の所有権を持たせない。
test('releases removed player frames and keeps versions monotonic after recovery', t => {
	const { textures, calls, frame } = fixture(t);
	const first = frame();
	textures.updateFrame('player', first);
	textures.getTexture('player');
	textures.updateFrame('player', null);
	assert.equal(first.closed, 1);
	assert.equal(textures.getTexture('player'), null);
	assert.ok(calls.textures.every(texture => texture.destroyed === 1));
	const next = frame(32, 18);
	textures.updateFrame('player', next);
	assert.equal(textures.frameVersions.get('player'), 3);
	assert.deepEqual(textures.getTexture('player').displayResolution, { width: 32, height: 18 });
	textures.dispose();
	assert.equal(next.closed, 1);
	assert.ok(calls.textures.every(texture => texture.destroyed === 1));
});

// 【転送失敗を正規化済みとしてキャッシュせず、再試行と破棄を可能にする】
// 部分初期化したテクスチャを後続ノードへ正常画像として渡すことを防ぐ。
test('retries failed normalization without caching partial results', t => {
	const { textures, calls, device, frame } = fixture(t);
	const first = frame();
	textures.updateFrame('player', first);
	const copy = device.queue.copyExternalImageToTexture;
	device.queue.copyExternalImageToTexture = () => { throw new Error('copy failed'); };
	assert.throws(() => textures.getTexture('player'), /copy failed/);
	device.queue.copyExternalImageToTexture = copy;
	assert.notEqual(textures.getTexture('player'), null);
	assert.deepEqual(calls.copies, [first]);
	assert.equal(calls.textures.length, 2);
});
