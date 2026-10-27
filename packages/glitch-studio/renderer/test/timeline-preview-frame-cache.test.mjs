import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelinePreviewFrameCache } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-preview-frame-cache.ts', import.meta.url)));

function fixture(t, maxBytes) {
	const original = ['GPUTextureUsage', 'GPUShaderStage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
	globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2 };
	globalThis.GPUShaderStage = { FRAGMENT: 2 };
	const textures = [];
	const device = {
		createPipelineLayout: () => ({}), createBindGroupLayout: () => ({}), createShaderModule: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBindGroup: () => ({}),
		createTexture({ size, format }) {
			const texture = { width: size[0], height: size[1], format, destroyed: false, createView: () => ({}), destroy() { this.destroyed = true; } };
			textures.push(texture);
			return texture;
		},
	};
	const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) };
	const cache = new TimelinePreviewFrameCache(device, {});
	cache.setMaxBytes(maxBytes);
	t.after(() => {
		cache.dispose();
		for (const [key, descriptor] of original) {
			if (descriptor != null) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	function capture(width = 2, height = 2, format = 'rgba8unorm') {
		return cache.capture(encoder, { width, height, format, createView: () => ({}) }, { label: 'metadata' });
	}
	function add(index, ...args) {
		const frame = capture(...args);
		assert.notEqual(frame, null);
		cache.commit(index, frame);
		return frame;
	}
	return { cache, textures, capture, add };
}

// 【生成順ではなく最終利用順で削除し、範囲の穴を埋めて表示しない】
// スクラブで再利用したフレームを残し、LRUの並び替えが時間順の表示を壊さないことを保証する。
test('evicts the least recently used frame and reports exact contiguous ranges', t => {
	const { cache, add } = fixture(t, 48);
	const first = add(0);
	const second = add(1);
	add(3);
	assert.equal(cache.get(0), first);
	cache.changed = false;
	cache.get(0);
	assert.equal(cache.changed, false, 'hits do not change the displayed ranges');
	add(4);
	assert.equal(second.texture.destroyed, true);
	assert.equal(first.texture.destroyed, false);
	assert.deepEqual(cache.snapshot(), { estimatedBytes: 48, maxBytes: 48,
		frameRanges: [{ startFrame: 0, endFrame: 1 }, { startFrame: 3, endFrame: 5 }] });
});

// 【解像度と保存形式の異なる画像もバイト数で管理する】
// モーションブラーのfloat画像を8bit画像と同じ枚数で扱うと上限を超過する。
// 巨大な一枚は既存フレームを追い出さず保存を見送り、容量変更は直ちに反映する。
test('accounts for actual dimensions and formats and trims immediately on capacity changes', t => {
	const { cache, add, capture, textures } = fixture(t, 128);
	const small = add(0, 2, 2, 'bgra8unorm');
	const half = add(1, 2, 2, 'rgba16float');
	add(2, 2, 2, 'rgba32float');
	assert.equal(cache.snapshot().estimatedBytes, 16 + 32 + 64);
	const count = textures.length;
	assert.equal(capture(100, 100), null);
	assert.equal(textures.length, count);
	assert.equal(small.texture.destroyed, false);
	cache.setMaxBytes(64);
	assert.equal(small.texture.destroyed, true);
	assert.equal(half.texture.destroyed, true);
	assert.deepEqual(cache.snapshot().frameRanges, [{ startFrame: 2, endFrame: 3 }]);
	cache.setMaxBytes(0);
	assert.equal(cache.snapshot().estimatedBytes, 0);
	assert.equal(cache.enabled, false);
	assert.equal(textures.every(texture => texture.destroyed), true);
});

// 【GPU完了待ちの間に無効化された画像を採用せず、同じ番号の置換も二重計上しない】
// 確保と公開を分けることで、非同期描画中の容量縮小でも破棄漏れや予算超過を防ぐ。
test('rechecks capacity when committing and replaces frames without double accounting', t => {
	const { cache, add, capture } = fixture(t, 32);
	const first = add(0);
	const replacement = add(0);
	assert.equal(first.texture.destroyed, true);
	assert.equal(cache.snapshot().estimatedBytes, 16);
	const pending = capture();
	cache.setMaxBytes(0);
	cache.commit(1, pending);
	assert.equal(pending.texture.destroyed, true);
	assert.equal(replacement.texture.destroyed, true);
	assert.deepEqual(cache.snapshot().frameRanges, []);
});
