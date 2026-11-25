import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { CurveAnimation } from '@gs/shared/curve-animation/curve-animation.ts';

/** 名前参照は先頭の定義を使う。ID参照では、同名のグローバル定義も選択できる。 */
export function getAvailableCurveAnimations(localCurveAnimations: readonly CurveAnimation[], projectCurveAnimations: readonly CurveAnimation[]): CurveAnimation[] {
	return [...localCurveAnimations, ...projectCurveAnimations];
}

/**
 * プロジェクトの定義をTimelineへ渡す境界。保存状態を変更せず、評価用の一覧だけを作る。
 * 子Sceneは各Scene自身の定義から構成し、Group/Transformのローカル定義を子へ継承しない。
 * Inline Nodes Effectの内部にも入らないため、その定義はプロジェクトから独立する。
 */
export function getTimelineScenesWithProjectCurveAnimations(scenes: TimelineScene[], curveAnimations: readonly CurveAnimation[]): TimelineScene[] {
	if (curveAnimations.length === 0) return scenes;
	const visit = (layer: TimelineLayer): TimelineLayer => layer.layerType === 'folder' ? { ...layer, layers: layer.layers.map(visit) } : ({
		...layer,
		curveAnimations: getAvailableCurveAnimations(layer.curveAnimations, curveAnimations),
		...(isTimelineContainerLayer(layer) ? { layers: layer.layers.map(visit) } : {}),
	});
	return scenes.map(scene => ({ ...scene, layers: scene.layers.map(visit) }));
}

export function validateProjectCurveAnimationName(curveAnimations: readonly CurveAnimation[], curveAnimation: Pick<CurveAnimation, 'id' | 'nameForReference'>): void {
	if (curveAnimation.nameForReference.trim().length === 0) throw new Error('Curve Animation nameForReference must not be empty');
	if (curveAnimations.some(candidate => candidate.id !== curveAnimation.id && candidate.nameForReference === curveAnimation.nameForReference)) {
		throw new Error('Curve Animation nameForReference must be unique within the project');
	}
}
