import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getTimelineMotionBlurBoundaries, getTimelineMotionBlurLoops, getTimelineSampleTimes, validateTimelineFps, validateTimelineMotionBlur } = await loadSource(fileURLToPath(new URL('../src/motion-blur.ts', import.meta.url)));
const { findTimelineHistoryEffects } = await loadSource(fileURLToPath(new URL('../src/render-history-effects.ts', import.meta.url)));
const settings = { enabled: true, shutterAngle: 180, samples: 8 };
const clip = (startMs, durationMs, extra = {}) => ({ startMs, durationMs, contentOffsetMs: 0, ...extra });
const scene = (id, layers) => ({ id, layers });

// 【ブラーを固定する枝のカット・ループ境界は他のレイヤーの露光を制限しない】
// 非表示とは異なり描画自体は続くが、クリップの選択も基準時刻で固定される。
// グループの子孫と子Scene参照を除外しつつ、同じ子Sceneの通常配置は境界を維持する。
test('excludes frozen layers and subtrees from cuts and loops without changing shared scene definitions', () => {
	const frozenImage = { layerType: 'image', forceDisableMotionBlur: true, clips: [clip(100, 100)] };
	const frozenGroup = { layerType: 'group', forceDisableMotionBlur: true, layers: [
		{ layerType: 'image', forceDisableMotionBlur: false, clips: [clip(300, 100)] },
	] };
	const scenes = [scene('root', [
		{ layerType: 'image', forceDisableMotionBlur: false, clips: [clip(0, 2000)] }, frozenImage, frozenGroup,
		{ layerType: 'scene', forceDisableMotionBlur: true, clips: [clip(500, 400, { sceneId: 'child', contentOffsetMs: 50 })] },
		{ layerType: 'scene', forceDisableMotionBlur: false, clips: [clip(1000, 400, { sceneId: 'child', contentOffsetMs: 50 })] },
	]), scene('child', [
		{ layerType: 'image', forceDisableMotionBlur: false, clips: [clip(100, 200)] },
		{ layerType: 'video', forceDisableMotionBlur: false, clips: [{ startMs: 200, durationMs: 400, sourceInMs: 0, sourceOutMs: 50, playbackRate: 1, loop: true }] },
	])];
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'root'), [0, 1000, 1050, 1150, 1250, 1400, 2000]);
	assert.deepEqual(getTimelineMotionBlurLoops(scenes, 'root'), [{ startMs: 1150, endMs: 1400, loopStartMs: 1150, loopDurationMs: 50 }]);
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'child'), [0, 100, 200, 300, 600]);
	const samples = getTimelineSampleTimes(100, 50, settings, getTimelineMotionBlurBoundaries(scenes, 'root'));
	assert.ok(samples[0] < 100 && samples.at(-1) > 100);
	frozenImage.forceDisableMotionBlur = false;
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'root'), [0, 100, 200, 1000, 1050, 1150, 1250, 1400, 2000]);
	frozenGroup.forceDisableMotionBlur = false;
	assert.ok(getTimelineMotionBlurBoundaries(scenes, 'root').includes(300));
	scenes[1].layers[1].forceDisableMotionBlur = true;
	assert.deepEqual(getTimelineMotionBlurLoops(scenes, 'root'), []);
});

// 【子Sceneの長さを決める固定レイヤーの終端を、親の露光境界へ戻さない】
// ブラー対象だけを列挙してもScene全体の終端を再帰的に加えると、固定字幕の出入りで
// 背景の露光が短くなる。子を直接描画するときの範囲制限と、通常レイヤーのカットは維持する。
test('keeps frozen child scene endings out of parent exposure while retaining root bounds and sampled cuts', () => {
	const scenes = [scene('root', [
		{ layerType: 'image', clips: [clip(0, 2000)] },
		{ layerType: 'scene', clips: [clip(0, 2000, { sceneId: 'child' })] },
	]), scene('child', [
		{ layerType: 'image', forceDisableMotionBlur: true, clips: [clip(100, 900)] },
		{ layerType: 'image', forceDisableMotionBlur: false, clips: [clip(200, 300)] },
	])];
	const boundaries = getTimelineMotionBlurBoundaries(scenes, 'root');
	assert.deepEqual(boundaries, [0, 200, 500, 2000]);
	const samples = getTimelineSampleTimes(999, 50, settings, boundaries);
	assert.ok(samples[0] < 999 && samples.at(-1) > 1000);
	assert.deepEqual(getTimelineSampleTimes(2000, 50, settings, boundaries), [2000]);
	const childBoundaries = getTimelineMotionBlurBoundaries(scenes, 'child');
	assert.deepEqual(childBoundaries, [0, 200, 500, 1000]);
	assert.ok(getTimelineSampleTimes(999, 50, settings, childBoundaries).every(time => time < 1000));
});

// 【子Sceneの境界を内容オフセットで変換し、音声とトリム区間外の境界を除外する】
// 異なる位置に配置した同じ子Sceneが、他の配置の境界や素材の未使用範囲に影響されないことを保証する。
test('collects nested visible boundaries without audio cuts or rounded offsets', () => {
	const scenes = [scene('root', [
		{ layerType: 'image', clips: [clip(0, 1000)] },
		{ layerType: 'audio', clips: [clip(30, 10)] },
		{ layerType: 'scene', clips: [clip(200, 400, { sceneId: 'child', contentOffsetMs: 50.25 }), clip(700, 200, { sceneId: 'child', contentOffsetMs: 300 })] },
	]), scene('child', [{ layerType: 'image', clips: [clip(100, 200), clip(300, 200)] }])];
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'root'), [0, 200, 249.75, 449.75, 600, 700, 900, 1000]);
});

// 【非表示レイヤーと子Sceneのカットで、表示中の映像の露光を切り詰めない】
// 描画対象から外すだけでは境界が残り、非表示レイヤーの開始・終了でブラーが変化してしまう。
// Scene自体の長さは配置全体で決まり、再表示すれば元のカット境界が復元される。
test('excludes disabled cuts and scene descendants from motion blur boundaries', () => {
	const hiddenImage = { layerType: 'image', isDisabled: true, clips: [clip(100, 200)] };
	const hiddenScene = { layerType: 'scene', isDisabled: true, clips: [clip(200, 400, { sceneId: 'child' })] };
	const scenes = [scene('root', [
		{ layerType: 'image', isDisabled: false, clips: [clip(0, 1000)] }, hiddenImage, hiddenScene,
	]), scene('child', [{ layerType: 'image', isDisabled: false, clips: [clip(100, 200)] }])];
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'root'), [0, 1000]);
	const samples = getTimelineSampleTimes(100, 60, settings, getTimelineMotionBlurBoundaries(scenes, 'root'));
	assert.ok(samples[0] < 100 && samples.at(-1) > 100);
	hiddenScene.isDisabled = false;
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'root'), [0, 200, 300, 500, 600, 1000]);
	scenes[1].layers[0].isDisabled = true;
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'root'), [0, 200, 600, 1000]);
	hiddenImage.isDisabled = false;
	assert.deepEqual(getTimelineMotionBlurBoundaries(scenes, 'root'), [0, 100, 200, 300, 600, 1000]);
});

// 【切り詰めた露光区間へ再配置し、カットちょうどは次の区間に属する】
// 前の映像の混入と先頭・末尾での暗化を防ぎ、指定したサンプル数を維持する。
test('redistributes samples inside half-open clip intervals', () => {
	const boundaries = [0, 100, 200];
	for (const time of [0, 1, 99, 100, 199]) {
		const samples = getTimelineSampleTimes(time, 50, settings, boundaries);
		assert.equal(samples.length, 8);
		const start = time < 100 ? 0 : 100;
		assert.ok(samples.every(sample => sample > start && sample < start + 100));
		assert.ok(samples.every(sample => Math.abs(sample - time) < 5));
	}
	assert.deepEqual(getTimelineSampleTimes(200, 50, settings, boundaries), [200]);
	assert.deepEqual(getTimelineSampleTimes(-1, 50, settings, boundaries), [-1]);
});

// 【キャッシュしたカット区間を、表示中の各ループの前後だけで狭める】
// 異なる周期の重なりでは最も近い境界を左右別々に採用し、開始前・終了済みの配置は除外する。
// 整列済みのカット配列を書き換えると後続フレームの二分探索が壊れるため、凍結した配列を渡す。
test('intersects active loop intervals with cached clip boundaries', () => {
	const boundaries = Object.freeze([0, 115, 125, 200]);
	const loops = [
		{ startMs: 100, endMs: 140, loopStartMs: 100, loopDurationMs: 10 },
		{ startMs: 102, endMs: 140, loopStartMs: 102, loopDurationMs: 8 },
		{ startMs: 120, endMs: 150, loopStartMs: 119, loopDurationMs: 1 },
		{ startMs: 0, endMs: 119, loopStartMs: 0, loopDurationMs: 1 },
	];
	const samples = getTimelineSampleTimes(119, 10, { enabled: true, shutterAngle: 360, samples: 4 }, boundaries, loops);
	assert.deepEqual(samples, [118.25, 118.75, 119.25, 119.75]);
});

// 【シャッター角と基準fpsから露光を計算し、サンプル数だけの変更では露光時間を保つ】
// 描画頻度を落としても長いブラーにならず、書き出しfpsを変えたときだけ露光時間が変わる。
test('separates preview quality from exposure and scales exposure with output fps', () => {
	const samples = getTimelineSampleTimes(100, 60, settings, [0, 1000]);
	const preview = getTimelineSampleTimes(100, 60, { ...settings, samples: 4 }, [0, 1000]);
	assert.equal(preview.length, 4);
	assert.equal(samples.length, 8);
	const exposureFromSamples = times => (times.at(-1) - times[0]) * times.length / (times.length - 1);
	assert.ok(Math.abs(exposureFromSamples(samples) - 1000 / 120) < 1e-10);
	assert.ok(Math.abs(exposureFromSamples(samples) - exposureFromSamples(preview)) < 1e-10);
	const slower = getTimelineSampleTimes(100, 30, settings, [0, 1000]);
	assert.ok(Math.abs(exposureFromSamples(slower) - 1000 / 60) < 1e-10);
});

// 【無効・0サンプル・1サンプルは基準時刻を保つ】
// 境界で露光が片側に偏っても、単独サンプルのプレビュー位置をずらさない。
test('uses the reference time for disabled or single-sample rendering', () => {
	for (const override of [{ enabled: false }, { shutterAngle: 0 }, { samples: 0 }, { samples: 1 }]) {
		assert.deepEqual(getTimelineSampleTimes(0, 60, { ...settings, ...override }, [0, 100]), [0]);
	}
});

// 【UI以外から来る設定でも無限ループや巨大なサンプル配列を作らない】
// 保存値・Command・Workerに共通の検証を使い、小数fpsは許可する。
test('validates finite fps, angles and bounded integer sample counts', () => {
	validateTimelineFps(29.97);
	validateTimelineMotionBlur(settings);
	for (const fps of [0, -1, NaN, Infinity, 121]) assert.throws(() => validateTimelineFps(fps));
	for (const override of [{ shutterAngle: 361 }, { shutterAngle: NaN }, { samples: -1 }, { samples: 1.5 }, { samples: 129 }, { enabled: 1 }]) {
		assert.throws(() => validateTimelineMotionBlur({ ...settings, ...override }));
	}
});

// 【配置されたエフェクトとVisual Moduleを検査し、Visual Module Live Preview専用の定義を警告しない】
// 履歴依存はノード自身の定義にあるため、直接レイヤーと内部ノードの両方を調べる必要がある。
test('finds history effects in placed definitions only', () => {
	const definitions = { feedback: { dependsOnRenderHistory: true }, flow: { dependsOnRenderHistory: true }, unused: { dependsOnRenderHistory: true }, fill: { dependsOnRenderHistory: false } };
	const visualModules = new Map([['used', { nodes: [{ type: 'effect', effectId: 'flow' }] }], ['visualModuleLivePreview', { nodes: [{ type: 'effect', effectId: 'unused' }] }]]);
	const scenes = [scene('root', [
		{ layerType: 'effect', effectId: 'feedback', clips: [clip(0, 100)] },
		{ layerType: 'effect', effectId: 'unused', clips: [] },
		{ layerType: 'visualModule', visualModuleId: 'used', clips: [clip(0, 100)] },
		{ layerType: 'inlineVisualModule', visualModule: { nodes: [{ type: 'effect', effectId: 'feedback' }, { type: 'effect', effectId: 'fill' }] }, clips: [clip(0, 100)] },
	])];
	assert.deepEqual(findTimelineHistoryEffects(scenes, id => visualModules.get(id), definitions), ['feedback', 'flow']);
});
