import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getTimelineLayerMaskSources, validateTimelineLayerMaskReferences, getTimelineLayerOutputDependencyGraph } = await loadSource(fileURLToPath(new URL('../src/layer-output.ts', import.meta.url)));
const { validateTimelineLayerMask } = await loadSource(fileURLToPath(new URL('../src/timeline-compositing.ts', import.meta.url)));
const { findDependencyCycle } = await loadSource(fileURLToPath(import.meta.resolve('@gs/shared/utility/dependency-cycle.ts')));
const leaf = id => ({ id, layerType: 'image', layerMask: null, isIncludedInComposite: true });
const group = (id, layers, compositingMode = 'flat') => ({ ...leaf(id), layerType: 'group', layers, compositingMode });
const transform = (id, layers) => ({ id, layerType: 'transform', layers });
const mask = sourceLayerId => ({ sourceLayerId, channel: 'alpha', inverted: false });
const key = (id, stage) => JSON.stringify([id, stage]);

// 【Transformを透過して同じ合成境界だけからマスク元を選ぶ】
// Group自身と子孫は異なる座標空間を持つ。preserveDepthでも境界の契約を変えず、
// Camera・音声・Transform自身を候補に出さないことで画像のない参照を防ぐ。
test('selects mask sources within the compositing boundary through transforms', () => {
	for (const mode of ['flat', 'preserveDepth']) {
		const layers = [leaf('target'), transform('parent', [leaf('sibling'), group('group', [leaf('child'), transform('inner', [leaf('other')])], mode)]),
			{ id: 'audio', layerType: 'audio' }, { id: 'camera', layerType: 'camera' }];
		assert.deepEqual(getTimelineLayerMaskSources(layers, 'target').map(layer => layer.id), ['sibling', 'group']);
		assert.deepEqual(getTimelineLayerMaskSources(layers, 'child').map(layer => layer.id), ['other']);
		assert.deepEqual(getTimelineLayerMaskSources(layers, 'group').map(layer => layer.id), ['target', 'sibling']);
		assert.deepEqual(getTimelineLayerMaskSources(layers, 'audio'), []);
	}
});

// 【参照切れは保持し、自己参照・境界越え・非映像への指定は拒否する】
// 削除のUndoで復旧するIDと、現在存在する不正な接続を区別する必要がある。
test('preserves missing sources while rejecting invalid mask references and settings', () => {
	const target = leaf('target');
	const layers = [target, group('group', [leaf('child')]), { id: 'audio', layerType: 'audio' }];
	for (const id of ['target', 'child', 'audio']) {
		target.layerMask = mask(id);
		assert.throws(() => validateTimelineLayerMaskReferences(layers), /compositing boundary/);
	}
	target.layerMask = mask('missing');
	assert.doesNotThrow(() => validateTimelineLayerMaskReferences(layers));
	assert.throws(() => validateTimelineLayerMask(mask('')), /mask source/);
	assert.throws(() => validateTimelineLayerMask({ ...mask('group'), channel: 'red' }), /Invalid timeline mask/);
});

// 【素材の参照にはマスク依存を加えず、単独描画と通常合成へだけ加える】
// マスク元が対象の素材を読む配線は成立する。素材生成時にマスクを解決すると
// この配線を循環と誤判定し、実行時にも自己待機してしまう。
test('keeps source dependencies independent from rendered masks and hidden composites', () => {
	const target = { ...leaf('target'), layerMask: mask('source') };
	const source = { ...leaf('source'), isIncludedInComposite: false };
	const graph = getTimelineLayerOutputDependencyGraph([source, target], id => id === 'source' ? [{ inputSource: 'anotherLayerOutput', layerId: 'target', outputStage: 'source' }] : []);
	assert.equal(findDependencyCycle(graph), null);
	assert.deepEqual(graph.get(key('target', 'source')), []);
	assert.deepEqual(graph.get(key('target', 'rendered')), [key('target', 'source'), key('source', 'rendered')]);
	assert.deepEqual(graph.get(key('source', 'composited')), [key('target', 'composited')]);
});

// 【マスク同士や下層入力経由の循環は無効化・表示区間で免除しない】
// 特定時刻だけ描画できる配線を許すと、再生中に参照の自己待機が発生する。
test('detects mask cycles including lower-layer image dependencies', () => {
	const target = { ...leaf('target'), layerMask: mask('source'), isDisabled: true };
	const source = { ...leaf('source'), layerMask: mask('target'), isIncludedInComposite: false };
	assert.notEqual(findDependencyCycle(getTimelineLayerOutputDependencyGraph([source, target], () => [])), null);
	source.layerMask = null;
	assert.notEqual(findDependencyCycle(getTimelineLayerOutputDependencyGraph([source, target], id => id === 'source' ? [{ inputSource: 'lowerLayerOutput' }] : [])), null);
});
