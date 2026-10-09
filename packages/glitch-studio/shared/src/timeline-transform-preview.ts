import type { TimelineLayerGeometry } from '@gs/subsystems_timeline_shared/layer-transform.ts';

/** プレビューの購読先。選択・再生状態はUIが所有し、保存データには含めない。 */
export type TimelineTransformObservation = { sceneId: string; layerId: string; requestId: number };
export type TimelineTransformPreview = {
	request: TimelineTransformObservation;
	revision: number;
	time: number;
	clipId: string | null;
	geometry: TimelineLayerGeometry | null;
	/** 同じScene内の祖先グループ。外側から内側の順で、ポインターの逆変換に使う。 */
	parentGeometries?: TimelineLayerGeometry[];
};
