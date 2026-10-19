import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisualModuleLivePreviewEffectStateStore } from '../src/utility/visual-module-live-preview-effect-status.ts';

// 同じノードを使うタイムラインレイヤーの読み込み状態をEditorへ表示しない。
test('keeps timeline layer loading out of the editor status', () => {
	const store = new VisualModuleLivePreviewEffectStateStore(new Map());
	const visualModuleLivePreview = { type: 'visualModuleLivePreview', instanceId: 'visualModuleLivePreview-1', visualModuleId: 'module' };
	const layer = { type: 'timelineLayer', instanceId: 'layer-1', visualModuleId: 'module', layerId: 'layer' };

	store.start('module', visualModuleLivePreview.instanceId);
	store.update(visualModuleLivePreview, 'video-node', { status: { type: 'ready' }, outputs: { output: { width: 640, height: 480 } } });
	store.update(layer, 'video-node', { status: { type: 'loading' }, outputs: { output: null } });
	assert.deepEqual(store.get('module', 'video-node'), { status: { type: 'ready' }, outputs: { output: { width: 640, height: 480 } } });

	// シークでVisual Module Live Previewが停止した後も、レイヤーの通知でEditorの表示を復活させない。
	store.stop();
	store.update(layer, 'video-node', { status: { type: 'loading' }, outputs: { output: null } });
	assert.equal(store.get('module', 'video-node'), null);
});

// 同じVisual Moduleを再度Visual Module Live Preview表示しても、旧インスタンスの遅延通知を採用しない。
test('ignores stale Visual Module Live Preview status after replacing an instance', () => {
	const store = new VisualModuleLivePreviewEffectStateStore(new Map());
	const previous = { type: 'visualModuleLivePreview', instanceId: 'visualModuleLivePreview-1', visualModuleId: 'module' };
	const current = { type: 'visualModuleLivePreview', instanceId: 'visualModuleLivePreview-2', visualModuleId: 'module' };

	store.start('module', previous.instanceId);
	store.update(previous, 'video-node', { status: { type: 'loading' }, outputs: { output: null } });
	store.start('module', current.instanceId);
	assert.equal(store.get('module', 'video-node'), null);

	store.update(previous, 'video-node', { status: { type: 'ready' }, outputs: { output: { width: 640, height: 480 } } });
	assert.equal(store.get('module', 'video-node'), null);
	store.update(current, 'video-node', { status: { type: 'error', message: 'decode failed' }, outputs: { output: null } });
	store.update(previous, 'video-node', null);
	assert.deepEqual(store.get('module', 'video-node'), { status: { type: 'error', message: 'decode failed' }, outputs: { output: null } });
	assert.equal(store.get('another-module', 'video-node'), null);

	store.update(current, 'video-node', null);
	assert.equal(store.get('module', 'video-node'), null);
});
