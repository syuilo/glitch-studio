import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { effectScope } from 'vue';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/preferences.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] });

// 【計測・解析設定は既定で有効になり、footerと同じモデル経由の変更を保存・復元する】
// 表示用のrefだけを書き換えても再起動後には復元できない。既存の環境設定に新しい
// キーがない場合の既定値と、片方の切り替えが他方を書き換えないことも確認する。
test('persists independent rendering preferences through models and restores them on restart', t => {
	const storage = new Map([['preferences', JSON.stringify({ previewVolume: 0.25 })]]);
	const window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'window', bundle.outputFiles[0].text)(
		createRequire(import.meta.url), module, module.exports, window);
	const { preferences, PreferencesManager } = module.exports;
	assert.equal(preferences.s.renderingStatsEnabled, true);
	assert.equal(preferences.s.waveformAndHistogramEnabled, true);
	const scope = effectScope();
	t.after(() => scope.stop());
	const models = scope.run(() => ({
		renderingStatsEnabled: preferences.model('renderingStatsEnabled'),
		waveformAndHistogramEnabled: preferences.model('waveformAndHistogramEnabled'),
	}));
	models.renderingStatsEnabled.value = false;
	assert.equal(new PreferencesManager().s.renderingStatsEnabled, false);
	assert.equal(new PreferencesManager().s.waveformAndHistogramEnabled, true);
	models.waveformAndHistogramEnabled.value = false;
	const restored = new PreferencesManager();
	assert.equal(restored.r.renderingStatsEnabled.value, false);
	assert.equal(restored.r.waveformAndHistogramEnabled.value, false);
	assert.equal(restored.s.previewVolume, 0.25);
	models.renderingStatsEnabled.value = true;
	assert.equal(new PreferencesManager().s.renderingStatsEnabled, true);
	assert.equal(new PreferencesManager().s.waveformAndHistogramEnabled, false);
});
