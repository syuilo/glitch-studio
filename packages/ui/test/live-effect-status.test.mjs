import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveEffectStatusStore } from '../src/utility/live-effect-status.ts';

// 同じノードを使うタイムラインレイヤーの読み込み状態をEditorへ表示しない。
test('keeps timeline layer loading out of the editor status', () => {
	const store = new LiveEffectStatusStore(new Map());
	const live = { type: 'live', instanceId: 'live-1', visualModuleId: 'module' };
	const layer = { type: 'timelineLayer', instanceId: 'layer-1', visualModuleId: 'module', layerId: 'layer' };

	store.start('module', live.instanceId);
	store.update(live, 'video-node', { type: 'ready' });
	store.update(layer, 'video-node', { type: 'loading' });
	assert.deepEqual(store.get('module', 'video-node'), { type: 'ready' });

	// シークでLIVEが停止した後も、レイヤーの通知でEditorの表示を復活させない。
	store.stop();
	store.update(layer, 'video-node', { type: 'loading' });
	assert.equal(store.get('module', 'video-node'), undefined);
});

// 同じVisual Moduleを再度LIVE表示しても、旧インスタンスの遅延通知を採用しない。
test('ignores stale live status after replacing an instance', () => {
	const store = new LiveEffectStatusStore(new Map());
	const previous = { type: 'live', instanceId: 'live-1', visualModuleId: 'module' };
	const current = { type: 'live', instanceId: 'live-2', visualModuleId: 'module' };

	store.start('module', previous.instanceId);
	store.update(previous, 'video-node', { type: 'loading' });
	store.start('module', current.instanceId);
	assert.equal(store.get('module', 'video-node'), undefined);

	store.update(previous, 'video-node', { type: 'ready' });
	assert.equal(store.get('module', 'video-node'), undefined);
	store.update(current, 'video-node', { type: 'error', message: 'decode failed' });
	store.update(previous, 'video-node', null);
	assert.deepEqual(store.get('module', 'video-node'), { type: 'error', message: 'decode failed' });
	assert.equal(store.get('another-module', 'video-node'), undefined);

	store.update(current, 'video-node', null);
	assert.equal(store.get('module', 'video-node'), undefined);
});
