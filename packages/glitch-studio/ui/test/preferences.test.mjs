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
	const storage = new Map([['preferences:previewVolume', '0.25']]);
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

// 【各画面は初期化時だけ設定を読み、変更項目だけを保存する】
// 他画面の通知を取り込まず、音量・GPU・バックアップの変更が無関係な項目を戻さない。
// 同じ項目の保存値は最後の変更を採用し、新規画面だけが最新値を使う。
test('keeps window snapshots independent while persisting only changed preferences', () => {
	const storage = new Map();
	const reads = [];
	const writes = [];
	function createWindow() {
		const window = { addEventListener() { assert.fail('Preferences must not subscribe to storage events'); }, localStorage: {
			getItem(key) { reads.push(key); return storage.get(key) ?? null; },
			setItem(key, value) { writes.push(key); storage.set(key, value); },
		} };
		const module = { exports: {} };
		new Function('require', 'module', 'exports', 'window', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, window);
		return module.exports.preferences;
	}
	const first = createWindow();
	const second = createWindow();
	const startupReadCount = reads.length;
	first.commit('importAssetsAsExternalReferences', true);
	assert.equal(second.s.importAssetsAsExternalReferences, false);
	second.commit('previewVolume', 0.1);
	assert.equal(first.s.previewVolume, 0.5);
	first.commit('enable32bitDataTextures', true);
	assert.equal(first.s.enable32bitDataTextures, true);
	assert.equal(second.s.enable32bitDataTextures, false);
	first.commit('projectBackupAutoEnabled', true);
	second.commit('projectBackupAutoIntervalMinutes', 5);
	assert.equal(first.s.projectBackupAutoIntervalMinutes, 1);
	assert.equal(second.s.projectBackupAutoEnabled, false);
	first.commit('previewVolume', 0.3);
	first.commit('previewVolume', 0.3);
	assert.equal(reads.length, startupReadCount);
	assert.deepEqual(writes, ['preferences:importAssetsAsExternalReferences', 'preferences:previewVolume',
		'preferences:enable32bitDataTextures', 'preferences:projectBackupAutoEnabled',
		'preferences:projectBackupAutoIntervalMinutes', 'preferences:previewVolume']);
	const reopened = createWindow();
	assert.equal(reopened.s.previewVolume, 0.3);
	assert.equal(reopened.s.enable32bitDataTextures, true);
	assert.equal(reopened.s.importAssetsAsExternalReferences, true);
	assert.equal(reopened.s.projectBackupAutoEnabled, true);
	assert.equal(reopened.s.projectBackupAutoIntervalMinutes, 5);
	assert.equal(first.s.projectBackupAutoIntervalMinutes, 1);
	assert.equal(second.s.previewVolume, 0.1);
});

// 【レイアウトの確定値は編集用オブジェクトから独立させ、同じ内容は再保存しない】
// コピー処理を一つに整理しても、呼び出し元の後続の編集で保存済みの設定が変わってはならない。
// 保存とリアクティブな状態更新が、同じ確定済みの内容を使うことも確認する。
test('isolates committed workspace values from later edits and skips equal copies', () => {
	const storage = new Map();
	let writes = 0;
	const window = { localStorage: { getItem: key => storage.get(key) ?? null,
		setItem(key, value) { storage.set(key, value); writes++; } } };
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'window', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, window);
	const { preferences } = module.exports;
	const layout = structuredClone(preferences.s.workspaceDefinition);
	layout.children[0].name = 'Edited workspace';
	preferences.commit('workspaceDefinition', layout);
	preferences.commit('workspaceDefinition', structuredClone(layout));
	layout.children[0].name = 'Later edit';
	assert.equal(writes, 1);
	assert.equal(preferences.s.workspaceDefinition.children[0].name, 'Edited workspace');
	assert.equal(preferences.r.workspaceDefinition.value.children[0].name, 'Edited workspace');
	assert.deepEqual(JSON.parse(storage.get('preferences:workspaceDefinition')), preferences.s.workspaceDefinition);
});
