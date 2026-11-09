import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelinePreviewFrameCache } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-preview-frame-cache.ts', import.meta.url)));

function fixture(t, maxBytes, precision = 'original') {
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
	const cache = new TimelinePreviewFrameCache(device, {}, maxBytes, precision);
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
// 巨大な一枚は既存フレームを追い出さず保存を見送り、上限内で保存可能な画像だけを保持する。
test('accounts for actual dimensions and formats and skips oversized frames', t => {
	const { cache, add, capture, textures } = fixture(t, 128);
	const small = add(0, 2, 2, 'bgra8unorm');
	const half = add(1, 2, 2, 'rgba16float');
	add(2, 2, 2, 'rgba32float');
	assert.equal(cache.snapshot().estimatedBytes, 16 + 32 + 64);
	const count = textures.length;
	assert.equal(capture(100, 100), null);
	assert.equal(textures.length, count);
	assert.equal(small.texture.destroyed, false);
	add(3, 2, 2, 'rgba16float');
	assert.equal(small.texture.destroyed, true);
	assert.equal(half.texture.destroyed, false);
	assert.equal(cache.snapshot().estimatedBytes, 128);
	assert.deepEqual(cache.snapshot().frameRanges, [{ startFrame: 1, endFrame: 4 }]);
	cache.clear();
	assert.equal(cache.snapshot().estimatedBytes, 0);
	assert.equal(cache.enabled, true);
	assert.equal(textures.every(texture => texture.destroyed), true);
});

// 【先行する複数フレームを後から登録しても上限を守り、同じ番号の置換も二重計上しない】
// capture時はまだ登録されていない他の画像があるため、固定容量でもcommit時のLRU調整は必要となる。
test('trims overlapping captures when committing and replaces frames without double accounting', t => {
	const { cache, add, capture } = fixture(t, 32);
	const first = add(0);
	const replacement = add(0);
	assert.equal(first.texture.destroyed, true);
	assert.equal(cache.snapshot().estimatedBytes, 16);
	const second = capture();
	const third = capture();
	cache.commit(1, second);
	cache.commit(2, third);
	assert.equal(replacement.texture.destroyed, true);
	assert.equal(second.texture.destroyed, false);
	assert.equal(third.texture.destroyed, false);
	assert.equal(cache.snapshot().estimatedBytes, 32);
	assert.deepEqual(cache.snapshot().frameRanges, [{ startFrame: 1, endFrame: 3 }]);
});

// 【8bit保存では元の形式ではなく保存先の4byteで判定し、同じ容量へ多くの画像を保持する】
// float画像の容量を使って保存可否やLRUを決めると、量子化しても保存数が増えない。
// R/RG出力も最終画像としてRGBAへ保存され、未対応の整数形式を誤ってbindingしないことを確認する。
test('stores supported sources as sRGB RGBA8 and budgets the destination bytes', t => {
	const { cache, capture, add } = fixture(t, 32, '8bit');
	for (const format of ['rgba16float', 'rgba32float', 'r16float', 'rg32float', 'bgra8unorm', 'rgba8unorm-srgb']) {
		const frame = add(0, 2, 2, format);
		assert.equal(frame.texture.format, 'rgba8unorm-srgb');
		assert.equal(frame.bytes, 16);
	}
	add(1, 2, 2, 'rgba32float');
	assert.deepEqual(cache.snapshot().frameRanges, [{ startFrame: 0, endFrame: 2 }]);
	assert.equal(cache.snapshot().estimatedBytes, 32);
	assert.equal(capture(2, 2, 'rgba8uint'), null);
	assert.equal(capture(3, 3, 'rgba16float'), null);
});

// 【容量0は生成時から無効とし、不正な容量はGPU資源を作る前に拒否する】
// 動的な容量更新を廃止しても、書き出しの既定値0と整数バイト数の制約を維持する。
test('disables captures at zero capacity and validates the static capacity', t => {
	const { cache, textures, capture } = fixture(t, 0, '8bit');
	assert.equal(cache.enabled, false);
	assert.equal(capture(), null);
	assert.equal(textures.length, 0);
	for (const maxBytes of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => new TimelinePreviewFrameCache({}, {}, maxBytes), RangeError);
	}
});
