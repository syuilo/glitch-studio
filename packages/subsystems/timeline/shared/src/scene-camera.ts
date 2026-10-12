import { getTimelineClipEnd, isTimelineClipActive } from './timing.ts';
import { TimelineCameraParameters } from './layers/camera/camera-parameters.ts';
import type { TimelineLayer, TimelineCameraLayer } from './types.ts';

/**
 * 表示順の先頭から、クリップが有効なカメラを一つ選ぶ。映像レイヤーとの位置関係には依存しない。
 * グループの内部は探索しない。平面化や親変形とは独立した、Scene全体の視点であるため。
 * ブラー無効時はクリップの選択も基準時刻へ固定し、露光の途中で別カメラへ切り替わるのを防ぐ。
 */
export function getActiveTimelineCamera(layers: readonly TimelineLayer[], time: number, referenceTime = time): { layer: TimelineCameraLayer; time: number } | undefined {
	for (const layer of layers) {
		if (layer.layerType !== 'camera' || layer.isDisabled) continue;
		const evaluationTime = layer.forceDisableMotionBlur ? referenceTime : time;
		if (layer.clips.some(clip => isTimelineClipActive(clip, evaluationTime))) return { layer, time: evaluationTime };
	}
	return undefined;
}

/**
 * 露光中に実際の選択が変わる時刻だけを保持する。ブラー無効のカメラは基準時刻で
 * 有効なら露光全体で下位を隠すため、単純なクリップ境界の集合では判定できない。
 * 最上段の有効な固定カメラが同じ間は境界も同じなので、その選択ごとに再利用する。
 * レイヤーの編集時には所有側がこの計画を作り直す。
 */
export class TimelineCameraCuts {
	private readonly cameras: TimelineCameraLayer[];
	private readonly frozenCameras: TimelineCameraLayer[];
	private readonly candidateTimes: number[];
	private readonly cache = new Map<TimelineCameraLayer | undefined, readonly number[]>();

	constructor(layers: readonly TimelineLayer[]) {
		this.cameras = layers.filter((layer): layer is TimelineCameraLayer => layer.layerType === 'camera' && !layer.isDisabled);
		this.frozenCameras = this.cameras.filter(layer => layer.forceDisableMotionBlur);
		this.candidateTimes = [...new Set(this.cameras.filter(layer => !layer.forceDisableMotionBlur)
			.flatMap(layer => layer.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)])))].sort((a, b) => a - b);
	}

	getBoundaries(referenceTime: number): readonly number[] {
		const frozen = getActiveTimelineCamera(this.frozenCameras, referenceTime)?.layer;
		const cached = this.cache.get(frozen);
		if (cached) return cached;
		const boundaries: number[] = [];
		let previous = getActiveTimelineCamera(this.cameras, -Infinity, referenceTime)?.layer;
		for (const time of this.candidateTimes) {
			const current = getActiveTimelineCamera(this.cameras, time, referenceTime)?.layer;
			// 同じカメラの隣接クリップは同じScene時計・設定を共有し、カットではない。
			if (current !== previous) boundaries.push(time);
			previous = current;
		}
		this.cache.set(frozen, boundaries);
		return boundaries;
	}
}

/** 最上位Scene・参照先Scene・プレビューで、同じ選択規則と基準カメラを使う。 */
export class TimelineSceneCamera {
	private parameters = new TimelineCameraParameters();

	evaluate(layers: readonly TimelineLayer[], time: number, isExport: boolean, referenceTime = time) {
		const active = getActiveTimelineCamera(layers, time, referenceTime);
		const settings = active && { paramValues: active.layer.cameraParamValues, automationGraphs: active.layer.automationGraphs };
		return this.parameters.evaluate(settings, active?.time ?? time, isExport);
	}
}
