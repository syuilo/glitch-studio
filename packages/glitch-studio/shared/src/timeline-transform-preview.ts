import type { TimelineLayerGeometry } from '@gs/subsystems_timeline_shared/layer-transform.ts';

/** プレビューの購読先。選択・再生状態はUIが所有し、保存データには含めない。 */
export type TimelineTransformObservation = { sceneId: string; layerId: string; requestId: number };
export type TimelineTransformPreview = {
	request: TimelineTransformObservation;
	revision: number;
	time: number;
	clipId: string | null;
	geometry: TimelineLayerGeometry | null;
};
