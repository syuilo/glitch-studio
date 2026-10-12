import { multiplyTimelineAffine, TIMELINE_IDENTITY } from './spatial.ts';
import type { TimelineAffine, TimelineRenderSpace } from './spatial.ts';
import type { EvaluatedTimelineTransform } from './layers/transform/transform.ts';

/** 移動は現在の親座標系で合成する。投影・平面化・切り抜きは子の描画まで行わない。 */
export function getTimelineTransformSpace(transform: EvaluatedTimelineTransform, space?: TimelineRenderSpace): TimelineRenderSpace {
	const translation: TimelineAffine = [1, 0, 0, 1, ...transform.position];
	return {
		...space,
		parent: multiplyTimelineAffine(space?.parent ?? TIMELINE_IDENTITY, translation),
		screenParent: multiplyTimelineAffine(space?.screenParent ?? TIMELINE_IDENTITY, translation),
		depth: (space?.depth ?? 0) + transform.z,
	};
}
