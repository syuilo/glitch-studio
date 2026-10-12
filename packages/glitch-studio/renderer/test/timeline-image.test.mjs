import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { timelineImageFrame, timelineTextureSize } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/timeline-image.ts')));
const frameBounds = { left: -1, bottom: -1, right: 1, top: 1 };

// 【プレビューへ返す論理寸法にGPUオブジェクトを混ぜない】
// GPUTextureはWorker間で構造化複製できない。画像・動画の枠にも数値だけを渡す。
test('returns serializable frame dimensions without GPU resources', () => {
	const texture = { width: 1920, height: 1080, createView() {} };
	assert.deepEqual(structuredClone(timelineImageFrame({ kind: 'texture', texture }, { width: 1, height: 1 })), { width: 1920, height: 1080 });
});

// 【巨大な画面外領域は範囲を切り捨てず画素密度で制限する】
// GPUの最大辺長と画素予算を守りつつ、縦横比を変えず親の変形で全域を戻せるようにする。
test('caps enlarged raster dimensions without modifying world bounds', () => {
	const bounds = { left: -10, right: 10, bottom: -10, top: 10 };
	const size = timelineTextureSize(bounds, { width: 1920, height: 1080 }, 8192);
	assert.ok(size.width <= 8192 && size.height <= 8192);
	assert.ok(size.width * size.height <= 1920 * 1080 * 4);
	assert.ok(Math.abs(size.width / size.height - 16 / 9) < 0.001);
	assert.equal(bounds.left, -10);
});

// 【8Kの基準フレームを拡張領域の予算で縮めない】
// 書き出し解像度を上げたのに細部が4K相当に制限される退行を防ぐ。
test('preserves the requested base resolution above the overscan pixel budget', () => {
	const frame = { width: 7680, height: 4320 };
	assert.deepEqual(timelineTextureSize(frameBounds, frame, 8192), frame);
	assert.throws(() => timelineTextureSize({ ...frameBounds, right: Infinity }, frame, 8192), /finite/);
});
