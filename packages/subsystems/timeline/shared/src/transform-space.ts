import { multiplyTimelineAffine, TIMELINE_IDENTITY, timelineGeometryMatrix } from './spatial.ts';
import type { TimelineRenderSpace } from './spatial.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EvaluatedTimelineTransform } from './layers/transform/transform.ts';

/** 投影・平面化・切り抜きは子の描画まで行わず、現在の親座標系へ変換を重ねる。 */
export function getTimelineTransformSpace(transform: EvaluatedTimelineTransform, frame: Resolution, space?: TimelineRenderSpace): TimelineRenderSpace {
	// Transform自身は素材枠を持たず、ローカル原点を支点に拡縮→回転→移動する。
	// 非等方scaleと子の回転から生じるせん断を失わないよう、成分へ分解せず行列で継承する。
	const local = timelineGeometryMatrix({
		sourceSize: frame,
		sceneSize: frame,
		transform: { ...transform, origin: [0, 0], fitMode: 'stretch' },
	});
	return {
		...space,
		parent: multiplyTimelineAffine(space?.parent ?? TIMELINE_IDENTITY, local),
		screenParent: multiplyTimelineAffine(space?.screenParent ?? TIMELINE_IDENTITY, local),
		depth: (space?.depth ?? 0) + transform.z,
	};
}
