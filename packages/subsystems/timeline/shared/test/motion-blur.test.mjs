import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getTimelineMotionBlurBoundaries, getTimelineSampleTimes, validateTimelineFps, validateTimelineMotionBlur } = await loadSource(fileURLToPath(new URL('../src/motion-blur.ts', import.meta.url)));
const { findTimelineHistoryEffects } = await loadSource(fileURLToPath(new URL('../src/render-history-effects.ts', import.meta.url)));
const settings = { enabled: true, shutterAngle: 180, samples: 8 };
const clip = (startMs, durationMs, extra = {}) => ({ startMs, durationMs, contentOffsetMs: 0, ...extra });
const scene = (id, layers) => ({ id, layers });

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

// 【配置されたエフェクトとVisual Moduleを検査し、LIVE専用の定義を警告しない】
// 履歴依存はノード自身の定義にあるため、直接レイヤーと内部ノードの両方を調べる必要がある。
test('finds history effects in placed definitions only', () => {
	const definitions = { feedback: { dependsOnRenderHistory: true }, flow: { dependsOnRenderHistory: true }, unused: { dependsOnRenderHistory: true }, fill: { dependsOnRenderHistory: false } };
	const visualModules = new Map([['used', { nodes: [{ type: 'effect', effectId: 'flow' }] }], ['live', { nodes: [{ type: 'effect', effectId: 'unused' }] }]]);
	const scenes = [scene('root', [
		{ layerType: 'effect', effectId: 'feedback', clips: [clip(0, 100)] },
		{ layerType: 'effect', effectId: 'unused', clips: [] },
		{ layerType: 'visualModule', visualModuleId: 'used', clips: [clip(0, 100)] },
		{ layerType: 'inlineVisualModule', visualModule: { nodes: [{ type: 'effect', effectId: 'feedback' }, { type: 'effect', effectId: 'fill' }] }, clips: [clip(0, 100)] },
	])];
	assert.deepEqual(findTimelineHistoryEffects(scenes, id => visualModules.get(id), definitions), ['feedback', 'flow']);
});
