import { getSceneDuration, getTimelineScene } from './scenes.ts';
import { getTimelineClipEnd } from './timing.ts';
import type { TimelineScene } from './types.ts';

export type TimelineMotionBlurSettings = {
	enabled: boolean;
	shutterAngle: number;
	samples: number;
};

export const MAX_MOTION_BLUR_SAMPLES = 128;

export function validateTimelineFps(fps: number): void {
	if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error('Timeline frame rate must be between 1 and 120 fps.');
}

export function validateTimelineMotionBlur(settings: TimelineMotionBlurSettings): void {
	if (!settings || typeof settings.enabled !== 'boolean'
		|| !Number.isFinite(settings.shutterAngle) || settings.shutterAngle < 0 || settings.shutterAngle > 360
		|| !Number.isInteger(settings.samples) || settings.samples < 0 || settings.samples > MAX_MOTION_BLUR_SAMPLES) {
		throw new Error(`Motion blur requires a shutter angle from 0 to 360 and integer sample counts from 0 to ${MAX_MOTION_BLUR_SAMPLES}.`);
	}
}

/** 検証済みのSceneグラフから境界を収集する。親のトリム区間外の境界は持ち込まない。 */
export function getTimelineMotionBlurBoundaries(scenes: readonly TimelineScene[], sceneId: string): number[] {
	const cache = new Map<string, number[]>();
	const collect = (id: string): number[] => {
		const cached = cache.get(id);
		if (cached) return cached;
		const scene = getTimelineScene(scenes, id);
		const boundaries = new Set([0, getSceneDuration(scene)]);
		for (const layer of scene.layers) {
			if (layer.layerType === 'audio') continue;
			for (const clip of layer.clips) {
				boundaries.add(clip.startMs);
				boundaries.add(getTimelineClipEnd(clip));
			}
			if (layer.layerType !== 'scene') continue;
			for (const clip of layer.clips) {
				for (const childBoundary of collect(clip.sceneId)) {
					const time = clip.startMs + (childBoundary - clip.contentOffsetMs);
					if (time > clip.startMs && time < getTimelineClipEnd(clip)) boundaries.add(time);
				}
			}
		}
		const result = [...boundaries].sort((a, b) => a - b);
		cache.set(id, result);
		return result;
	};
	return collect(sceneId);
}

/** 出力fpsと露光時間の関係だけを扱い、プレビューの描画頻度や書き出し範囲には依存しない。 */
export function getTimelineSampleTimes(time: number, fps: number, settings: TimelineMotionBlurSettings, boundaries: readonly number[]): number[] {
	const count = settings.samples;
	if (!settings.enabled || settings.shutterAngle === 0 || count <= 1) return [time];
	// upper_boundで境界ちょうどを後ろの区間に所属させ、既存の[start, end)と一致させる。
	let low = 0;
	let high = boundaries.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (boundaries[middle] <= time) low = middle + 1;
		else high = middle;
	}
	// Scene外のシークでは通常の透明出力を保ち、終端直後へ残像を持ち出さない。
	if (low === 0 || low === boundaries.length) return [time];
	const halfExposure = 500 / fps * settings.shutterAngle / 360;
	const start = Math.max(time - halfExposure, boundaries[low - 1]);
	const end = Math.min(time + halfExposure, boundaries[low]);
	if (end <= start) return [time];
	// 切り詰めた区間内に再配置することで、サンプル数と重みの合計1を維持する。
	// 編集時の整数ms丸めは適用せず、細かい動きも小数時刻で評価する。
	return Array.from({ length: count }, (_, index) => start + (end - start) * ((index + 0.5) / count));
}
