import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getImageAnalysisChunkCount, MAX_IMAGE_ANALYSIS_DIRECT_SAMPLES } from '../src/utility/image-analysis-accumulation.ts';

// 【不透明な全サンプルが同じカウンターに入っても、u32上限までは直接集計する】
// 保守的な8192画素の部分和サイズを直接集計の上限と取り違えると、通常モードにも余計なGPU処理が残る。
// 上限の1サンプル上では既にあふれることを整数演算で確認し、境界の取り違えを防ぐ。
test('uses direct accumulation through the exact fixed-point u32 limit', () => {
	assert.equal(BigInt(MAX_IMAGE_ANALYSIS_DIRECT_SAMPLES) * 65535n, 0xffffffffn);
	assert.ok(BigInt(MAX_IMAGE_ANALYSIS_DIRECT_SAMPLES + 1) * 65535n > 0xffffffffn);
	for (const count of [1, 8192, 8193, 10000, 65536, 65537]) assert.equal(getImageAnalysisChunkCount(count), 1);
});

// 【u32の上限を超える場合だけ、全サンプルを覆う安全な部分和へ分割する】
// 末尾の不完全な部分和を落とさず、大きな入力でも各部分和の加算がu32に収まることを保証する。
test('splits overflowing counts into bounded partial sums including the last samples', () => {
	for (const count of [65538, 131072, 262144, 7680 * 4320]) {
		const chunks = getImageAnalysisChunkCount(count);
		assert.ok(chunks > 1);
		assert.ok(chunks * 8192 >= count);
		assert.ok((chunks - 1) * 8192 < count);
		assert.ok(8192n * 65535n <= 0xffffffffn);
	}
});
