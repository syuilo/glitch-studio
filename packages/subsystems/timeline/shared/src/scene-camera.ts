import { getTimelineLayerCustomParameterContext } from './custom-parameters.ts';
import { getTimelineClipEnd, isTimelineClipActive } from './timing.ts';
import { TimelineCameraParameters } from './layers/camera/camera-parameters.ts';
import { TimelineTransformParameters } from './layers/transform/transform-parameters.ts';
import type { TimelineLayer, TimelineCameraLayer, TimelineTransformLayer } from './types.ts';
import { getTimelineTransformSpace } from './transform-space.ts';
import { TIMELINE_IDENTITY, transformTimelinePoint } from './spatial.ts';
import type { TimelineRenderSpace } from './spatial.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

type CameraCandidate = { layer: TimelineCameraLayer; ancestors: TimelineTransformLayer[]; frozen: boolean };

/** Groupは合成境界なので探索せず、Transformだけを表示順に透過する。 */
export function getTimelineCameraCandidates(layers: readonly TimelineLayer[], ancestors: TimelineTransformLayer[] = [], frozen = false): CameraCandidate[] {
	return layers.flatMap<CameraCandidate>(layer => {
		if (layer.isDisabled) return [];
		if (layer.layerType === 'transform') return getTimelineCameraCandidates(layer.layers, [...ancestors, layer], frozen || layer.forceDisableMotionBlur);
		return layer.layerType === 'camera' ? [{ layer, ancestors, frozen: frozen || layer.forceDisableMotionBlur }] : [];
	});
}

function selectCamera(candidates: readonly CameraCandidate[], time: number, referenceTime: number) {
	for (const candidate of candidates) {
		const evaluationTime = candidate.frozen ? referenceTime : time;
		if (candidate.layer.clips.some(clip => isTimelineClipActive(clip, evaluationTime))) return { ...candidate, time: evaluationTime };
	}
	return null;
}

/**
 * 表示順の先頭から、クリップが有効なカメラを一つ選ぶ。映像レイヤーとの位置関係には依存しない。
 * Transformの配下も同じ表示順に並べ、折りたたみ状態に依存しない。
 * ブラー無効時はクリップの選択も基準時刻へ固定し、露光の途中で別カメラへ切り替わるのを防ぐ。
 */
export function getActiveTimelineCamera(layers: readonly TimelineLayer[], time: number, referenceTime = time) {
	return selectCamera(getTimelineCameraCandidates(layers), time, referenceTime);
}

/**
 * 露光中に実際の選択が変わる時刻だけを保持する。ブラー無効のカメラは基準時刻で
 * 有効なら露光全体で下位を隠すため、単純なクリップ境界の集合では判定できない。
 * 最上段の有効な固定カメラが同じ間は境界も同じなので、その選択ごとに再利用する。
 * レイヤーの編集時には所有側がこの計画を作り直す。
 */
export class TimelineCameraCuts {
	private readonly cameras: CameraCandidate[];
	private readonly frozenCameras: CameraCandidate[];
	private readonly candidateTimes: number[];
	private readonly cache = new Map<TimelineCameraLayer | null, readonly number[]>();

	constructor(layers: readonly TimelineLayer[]) {
		this.cameras = getTimelineCameraCandidates(layers);
		this.frozenCameras = this.cameras.filter(candidate => candidate.frozen);
		this.candidateTimes = [...new Set(this.cameras.filter(candidate => !candidate.frozen)
			.flatMap(({ layer }) => layer.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)])))].sort((a, b) => a - b);
	}

	getBoundaries(referenceTime: number): readonly number[] {
		const frozen = selectCamera(this.frozenCameras, referenceTime, referenceTime)?.layer ?? null;
		const cached = this.cache.get(frozen);
		if (cached) return cached;
		const boundaries: number[] = [];
		let previous = selectCamera(this.cameras, -Infinity, referenceTime)?.layer;
		for (const time of this.candidateTimes) {
			const current = selectCamera(this.cameras, time, referenceTime)?.layer;
			// 同じカメラの隣接クリップは同じScene時計・設定を共有し、カットではない。
			if (current !== previous) boundaries.push(time);
			previous = current;
		}
		this.cache.set(frozen, boundaries);
		return boundaries;
	}
}

/** 最上位Scene・参照先Scene・プレビューで、同じカメラ選択規則を使う。 */
export class TimelineSceneCamera {
	private parameters = new TimelineCameraParameters();
	private transforms = new TimelineTransformParameters();

	evaluate(layers: readonly TimelineLayer[], time: number, isExport: boolean, frame: Resolution, referenceTime = time) {
		const active = getActiveTimelineCamera(layers, time, referenceTime);
		// 有効なカメラがない区間は2D合成とし、Zによる拡縮・近接面での非表示を行わない。
		if (!active) return null;
		const settings = { paramValues: active.layer.cameraParamValues, automationGraphs: active.layer.automationGraphs };
		const camera = this.parameters.evaluate(settings, active.time, isExport, getTimelineLayerCustomParameterContext([...layers], active.layer.id));
		let ancestorTime = time;
		let space: TimelineRenderSpace = { parent: TIMELINE_IDENTITY, depth: 0 };
		for (const parent of active.ancestors) {
			// 子カメラだけのブラー無効では親の揺れを止めない。親を固定した場合は
			// そこから下の時計を固定し、映像のTransform走査と同じ継承規則にする。
			if (parent.forceDisableMotionBlur) ancestorTime = referenceTime;
			const transform = this.transforms.evaluate(parent.transformParamValues, parent.automationGraphs, ancestorTime, isExport, getTimelineLayerCustomParameterContext([...layers], parent.id));
			space = getTimelineTransformSpace(transform, frame, space);
			// 非等方scale・反転・せん断はカメラの向きや画角へ継承しない。
			// 行列から角度を抽出せず、親のrotationだけを独立して積み重ねる。
			camera.roll += transform.rotation;
		}
		camera.position = transformTimelinePoint(space.parent, camera.position);
		camera.z += space.depth;
		return camera;
	}
}
