import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CustomNodeGraphEffectLivePreviewEffectStateStore } from '../src/utility/custom-node-graph-effect-live-preview-effect-status.ts';

// 同じノードを使うタイムラインレイヤーの読み込み状態をEditorへ表示しない。
test('keeps timeline layer loading out of the editor status', () => {
	const store = new CustomNodeGraphEffectLivePreviewEffectStateStore(new Map());
	const customNodeGraphEffectLivePreview = { type: 'customNodeGraphEffectLivePreview', instanceId: 'customNodeGraphEffectLivePreview-1', customNodeGraphEffectId: 'customNodeGraphEffect' };
	const layer = { type: 'timelineLayer', instanceId: 'layer-1', customNodeGraphEffectId: 'customNodeGraphEffect', layerId: 'layer' };

	store.start('customNodeGraphEffect', customNodeGraphEffectLivePreview.instanceId);
	store.update(customNodeGraphEffectLivePreview, 'video-node', { status: { type: 'ready' }, outputs: { output: { width: 640, height: 480 } } });
	store.update(layer, 'video-node', { status: { type: 'loading' }, outputs: { output: null } });
	assert.deepEqual(store.get('customNodeGraphEffect', 'video-node'), { status: { type: 'ready' }, outputs: { output: { width: 640, height: 480 } } });

	// シークでCustom Node Graph Effect Live Previewが停止した後も、レイヤーの通知でEditorの表示を復活させない。
	store.stop();
	store.update(layer, 'video-node', { status: { type: 'loading' }, outputs: { output: null } });
	assert.equal(store.get('customNodeGraphEffect', 'video-node'), null);
});

// 同じCustom Node Graph Effectを再度Custom Node Graph Effect Live Preview表示しても、旧インスタンスの遅延通知を採用しない。
test('ignores stale Custom Node Graph Effect Live Preview status after replacing an instance', () => {
	const store = new CustomNodeGraphEffectLivePreviewEffectStateStore(new Map());
	const previous = { type: 'customNodeGraphEffectLivePreview', instanceId: 'customNodeGraphEffectLivePreview-1', customNodeGraphEffectId: 'customNodeGraphEffect' };
	const current = { type: 'customNodeGraphEffectLivePreview', instanceId: 'customNodeGraphEffectLivePreview-2', customNodeGraphEffectId: 'customNodeGraphEffect' };

	store.start('customNodeGraphEffect', previous.instanceId);
	store.update(previous, 'video-node', { status: { type: 'loading' }, outputs: { output: null } });
	store.start('customNodeGraphEffect', current.instanceId);
	assert.equal(store.get('customNodeGraphEffect', 'video-node'), null);

	store.update(previous, 'video-node', { status: { type: 'ready' }, outputs: { output: { width: 640, height: 480 } } });
	assert.equal(store.get('customNodeGraphEffect', 'video-node'), null);
	store.update(current, 'video-node', { status: { type: 'error', message: 'decode failed' }, outputs: { output: null } });
	store.update(previous, 'video-node', null);
	assert.deepEqual(store.get('customNodeGraphEffect', 'video-node'), { status: { type: 'error', message: 'decode failed' }, outputs: { output: null } });
	assert.equal(store.get('another-customNodeGraphEffect', 'video-node'), null);

	store.update(current, 'video-node', null);
	assert.equal(store.get('customNodeGraphEffect', 'video-node'), null);
});
