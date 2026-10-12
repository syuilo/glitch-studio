import { isTimelineClipActive } from './timing.ts';
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

/** 最上位Scene・参照先Scene・プレビューで、同じ選択規則と基準カメラを使う。 */
export class TimelineSceneCamera {
	private parameters = new TimelineCameraParameters();

	evaluate(layers: readonly TimelineLayer[], time: number, isExport: boolean, referenceTime = time) {
		const active = getActiveTimelineCamera(layers, time, referenceTime);
		const settings = active && { paramValues: active.layer.cameraParamValues, automationGraphs: active.layer.automationGraphs };
		return this.parameters.evaluate(settings, active?.time ?? time, isExport);
	}
}
