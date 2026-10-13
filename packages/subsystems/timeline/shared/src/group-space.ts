import { TIMELINE_IDENTITY, multiplyTimelineAffine, projectTimelineMatrix, timelineGeometryMatrix } from './spatial.ts';
import type { TimelineAffine, TimelineRenderSpace } from './spatial.ts';
import type { TimelineLayerTransform } from './layer-transform.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import { getTimelineTransformSpace } from './transform-space.ts';
import type { EvaluatedTimelineTransform } from './layers/transform/transform.ts';
import type { TimelineLayerCoordinateSpace } from './timeline-compositing.ts';

type SpatialSettings = TimelineLayerTransform & { coordinateSpace: TimelineLayerCoordinateSpace; depth: number };
type GroupPlacement = { settings: SpatialSettings; compositingMode?: 'flat' | 'preserveDepth' };

export function getTimelineGroupSpace(group: GroupPlacement, frame: Resolution, space?: TimelineRenderSpace): TimelineRenderSpace {
	if (group.compositingMode !== 'preserveDepth') return { parent: TIMELINE_IDENTITY, depth: 0 };
	const local = timelineGeometryMatrix({ sourceSize: frame, sceneSize: frame, transform: group.settings });
	const screen = group.settings.coordinateSpace === 'screen';
	return { parent: multiplyTimelineAffine(screen ? space?.screenParent ?? TIMELINE_IDENTITY : space?.parent ?? TIMELINE_IDENTITY, local),
										screenParent: space?.screenParent,
										depth: (screen ? 0 : space?.depth ?? 0) + group.settings.depth,
										camera: screen ? null : space?.camera, viewport: space?.viewport };
}

/**
 * 編集対象のローカル座標から画面への親変換。平面化された外側では一度だけ投影し、
 * 内側のZは無視する。描画と同じ境界を辿ることで、ドラッグの逆変換も一致させる。
 */
export function getTimelinePreviewParent(ancestors: readonly (GroupPlacement | { translation: EvaluatedTimelineTransform })[], settings: SpatialSettings, frame: Resolution, root: TimelineRenderSpace): TimelineAffine | null {
	let boundary = TIMELINE_IDENTITY;
	let space = root;
	for (const group of ancestors) {
		if ('translation' in group) { space = getTimelineTransformSpace(group.translation, space); continue; }
		if (group.compositingMode !== 'preserveDepth') {
			const local = timelineGeometryMatrix({ sourceSize: frame, sceneSize: frame, transform: group.settings });
			const plane = group.settings.coordinateSpace === 'screen' ? multiplyTimelineAffine(space.screenParent ?? TIMELINE_IDENTITY, local)
				: projectTimelineMatrix(multiplyTimelineAffine(space.parent, local), space.depth + group.settings.depth, space.camera);
			if (!plane) return null;
			boundary = multiplyTimelineAffine(boundary, plane);
		}
		space = getTimelineGroupSpace(group, frame, space);
	}
	const parent = settings.coordinateSpace === 'screen' ? space.screenParent ?? TIMELINE_IDENTITY : projectTimelineMatrix(space.parent, space.depth + settings.depth, space.camera);
	return parent ? multiplyTimelineAffine(boundary, parent) : null;
}
