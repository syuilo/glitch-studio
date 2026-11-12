import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRendererRequiredGpuFeatures } from '../src/renderer-gpu-features.ts';

// 【自動モードは利用可能なGPU計測を確保し、非対応GPUでは要求しない】
// 統計が無効なプレビューと書き出しでも自動制御にはQueryを使う一方、
// optional featureがないGPUでDevice生成そのものを失敗させない。
test('requests optional timestamp queries for automatic tiling when available', () => {
	const adapter = { features: new Set(['timestamp-query']) };
	assert.deepEqual(getRendererRequiredGpuFeatures(adapter, { enable32bitDataTextures: false }), ['timestamp-query']);
	assert.deepEqual(getRendererRequiredGpuFeatures({ features: new Set() }, { enable32bitDataTextures: false }), []);
	for (const mode of ['disabled', 'manual']) {
		assert.deepEqual(getRendererRequiredGpuFeatures(adapter, { enable32bitDataTextures: false, effectRenderTiling: { mode, tileSize: 64 } }), []);
	}
});

// 【データ精度・GPU統計の機能要求を維持し、自動モードと統計でQueryを二重要求しない】
// Timestamp Queryの有効化だけで通常パスに計測コマンドを追加するものではない。
// 既存の32bitテクスチャや明示的なGPU統計の設定も引き続き反映する。
test('preserves explicit data precision and GPU statistics requirements without duplicates', () => {
	const adapter = { features: new Set(['timestamp-query', 'float32-filterable']) };
	assert.deepEqual(getRendererRequiredGpuFeatures(adapter, { enable32bitDataTextures: true, enableGpuStatistics: true }),
		['float32-filterable', 'timestamp-query']);
	assert.deepEqual(getRendererRequiredGpuFeatures(adapter, { enable32bitDataTextures: false, enableGpuStatistics: true, effectRenderTiling: { mode: 'disabled' } }),
		['timestamp-query']);
});
