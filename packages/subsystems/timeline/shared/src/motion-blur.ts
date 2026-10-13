import { isTimelineContainerLayer } from './types.ts';
import { getTimelineCameraCandidates } from './scene-camera.ts';
import { getSceneDuration, getTimelineScene } from './scenes.ts';
import { getTimelineClipEnd, getTimelineLoopCycle } from './timing.ts';
import { getTimelineMediaPeriod } from './media-timing.ts';
import { TimelineCameraCuts } from './scene-camera.ts';
import type { TimelineClipLayer, TimelineLayer, TimelineScene } from './types.ts';

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

/** 固定する枝は除外する。カメラは優先順位も必要なため別途計画し、Scene参照は呼び出し側で辿る。 */
function* getMotionBlurLayers(layers: readonly TimelineLayer[]): Generator<TimelineClipLayer> {
	for (const layer of layers) {
		if (layer.isDisabled || layer.layerType === 'audio' || layer.layerType === 'camera' || layer.forceDisableMotionBlur) continue;
		if (isTimelineContainerLayer(layer)) yield* getMotionBlurLayers(layer.layers);
		else yield layer;
	}
}

/** 通常の映像カットを収集する。カメラは別計画とし、親のトリム区間外の境界は持ち込まない。 */
export function getTimelineMotionBlurBoundaries(scenes: readonly TimelineScene[], sceneId: string): number[] {
	const cache = new Map<string, ReadonlySet<number>>();
	const collect = (id: string): ReadonlySet<number> => {
		const cached = cache.get(id);
		if (cached) return cached;
		const scene = getTimelineScene(scenes, id);
		const boundaries = new Set<number>();
		for (const layer of getMotionBlurLayers(scene.layers)) {
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
		cache.set(id, boundaries);
		return boundaries;
	};
	// Sceneの長さには固定・非表示・音声レイヤーも含まれる。子Sceneの長さを
	// カットとして親へ戻すと、走査から除外したレイヤーの終端が露光を制限してしまう。
	// 保存上の長さは変えず、描画対象となる最上位Sceneの範囲だけを最後に加える。
	const boundaries = new Set(collect(sceneId));
	boundaries.add(0);
	boundaries.add(getSceneDuration(getTimelineScene(scenes, sceneId)));
	return [...boundaries].sort((a, b) => a - b);
}

/** 同じSceneのカメラ選択計画を共有し、配置ごとの表示区間とScene時計だけを持つ。 */
export type TimelineMotionBlurCameraCuts = {
	startMs: number;
	endMs: number;
	sceneStartMs: number;
	cuts: TimelineCameraCuts;
};

/** カメラの境界は固定カメラの選択に依存するため、通常の映像カットと分けて計画する。 */
export function getTimelineMotionBlurCameraCuts(scenes: readonly TimelineScene[], sceneId: string): TimelineMotionBlurCameraCuts[] {
	const placements: TimelineMotionBlurCameraCuts[] = [];
	const plans = new Map<string, TimelineCameraCuts>();
	const visit = (id: string, sceneStartMs: number, startMs: number, endMs: number) => {
		const scene = getTimelineScene(scenes, id);
		if (getTimelineCameraCandidates(scene.layers).length > 0) {
			let cuts = plans.get(id);
			if (!cuts) { cuts = new TimelineCameraCuts(scene.layers); plans.set(id, cuts); }
			placements.push({ startMs, endMs, sceneStartMs, cuts });
		}
		for (const layer of getMotionBlurLayers(scene.layers)) {
			if (layer.layerType !== 'scene') continue;
			for (const clip of layer.clips) {
				const clipStartMs = sceneStartMs + clip.startMs;
				const visibleStartMs = Math.max(startMs, clipStartMs);
				const visibleEndMs = Math.min(endMs, sceneStartMs + getTimelineClipEnd(clip));
				if (visibleEndMs <= visibleStartMs) continue;
				visit(clip.sceneId, clipStartMs - clip.contentOffsetMs, visibleStartMs, visibleEndMs);
			}
		}
	};
	visit(sceneId, 0, 0, getSceneDuration(getTimelineScene(scenes, sceneId)));
	return placements;
}

/** 最上位Scene上の表示区間と周期。親のトリムで表示開始が変わっても周期の原点は維持する。 */
export type TimelineMotionBlurLoop = {
	startMs: number;
	endMs: number;
	loopStartMs: number;
	loopDurationMs: number;
};

/** 編集時にだけSceneを探索し、周回数によらない配置単位の情報をキャッシュできるようにする。 */
export function getTimelineMotionBlurLoops(scenes: readonly TimelineScene[], sceneId: string): TimelineMotionBlurLoop[] {
	const loops: TimelineMotionBlurLoop[] = [];
	const visit = (id: string, sceneStartMs: number, startMs: number, endMs: number) => {
		for (const layer of getMotionBlurLayers(getTimelineScene(scenes, id).layers)) {
			if (layer.layerType !== 'video' && layer.layerType !== 'scene') continue;
			for (const clip of layer.clips) {
				const clipStartMs = sceneStartMs + clip.startMs;
				const visibleStartMs = Math.max(startMs, clipStartMs);
				const visibleEndMs = Math.min(endMs, sceneStartMs + getTimelineClipEnd(clip));
				if (visibleEndMs <= visibleStartMs) continue;
				if ('sceneId' in clip) {
					visit(clip.sceneId, clipStartMs - clip.contentOffsetMs, visibleStartMs, visibleEndMs);
				} else if ('sourceInMs' in clip && clip.loop) {
					loops.push({ startMs: visibleStartMs, endMs: visibleEndMs, loopStartMs: clipStartMs, loopDurationMs: getTimelineMediaPeriod(clip) });
				}
			}
		}
	};
	visit(sceneId, 0, 0, getSceneDuration(getTimelineScene(scenes, sceneId)));
	return loops;
}

function findNextBoundary(boundaries: readonly number[], time: number): number {
	// upper_boundで境界ちょうどを後ろの区間に所属させ、既存の[start, end)と一致させる。
	let low = 0;
	let high = boundaries.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (boundaries[middle] <= time) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** 出力fpsと露光時間の関係だけを扱い、プレビューの描画頻度や書き出し範囲には依存しない。 */
export function getTimelineSampleTimes(time: number, fps: number, settings: TimelineMotionBlurSettings, boundaries: readonly number[], loops: readonly TimelineMotionBlurLoop[] = [], cameras: readonly TimelineMotionBlurCameraCuts[] = []): number[] {
	const count = settings.samples;
	if (!settings.enabled || settings.shutterAngle === 0 || count <= 1) return [time];
	const next = findNextBoundary(boundaries, time);
	// Scene外のシークでは通常の透明出力を保ち、終端直後へ残像を持ち出さない。
	if (next === 0 || next === boundaries.length) return [time];
	const halfExposure = 500 / fps * settings.shutterAngle / 360;
	let start = Math.max(time - halfExposure, boundaries[next - 1]);
	let end = Math.min(time + halfExposure, boundaries[next]);
	for (const camera of cameras) {
		if (time < camera.startMs || time >= camera.endMs) continue;
		const sceneTime = time - camera.sceneStartMs;
		const cuts = camera.cuts.getBoundaries(sceneTime);
		const nextCut = findNextBoundary(cuts, sceneTime);
		// 子Sceneの時計を戻してから親の露光へ交差させる。同じSceneを複数配置しても、
		// 基準時刻で有効な固定カメラとトリム区間は配置ごとに独立して解釈する。
		if (nextCut > 0) start = Math.max(start, cuts[nextCut - 1] + camera.sceneStartMs);
		if (nextCut < cuts.length) end = Math.min(end, cuts[nextCut] + camera.sceneStartMs);
	}
	// 静的な境界は二分探索で再利用し、表示中のループの前後だけで露光を狭める。
	// 全境界を結合・再ソートせず、ループのないSceneでは周期の探索を行わない。
	for (const loop of loops) {
		if (time < loop.startMs || time >= loop.endMs) continue;
		const cycleStartMs = loop.loopStartMs + getTimelineLoopCycle(loop.loopStartMs, loop.loopDurationMs, time) * loop.loopDurationMs;
		start = Math.max(start, loop.startMs, cycleStartMs);
		end = Math.min(end, loop.endMs, cycleStartMs + loop.loopDurationMs);
	}
	if (end <= start) return [time];
	// 切り詰めた区間内に再配置することで、サンプル数と重みの合計1を維持する。
	// 編集時の整数ms丸めは適用せず、細かい動きも小数時刻で評価する。
	return Array.from({ length: count }, (_, index) => start + (end - start) * ((index + 0.5) / count));
}
