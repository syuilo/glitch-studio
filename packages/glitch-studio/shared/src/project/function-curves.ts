import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { SharedFunctionCurve } from '@gs/shared/function-curve/function-curve.ts';

/** 名前参照は先頭の定義を使う。ID参照では、同名のグローバル定義も選択できる。 */
export function getAvailableFunctionCurves(localFunctionCurves: readonly SharedFunctionCurve[], projectFunctionCurves: readonly SharedFunctionCurve[]): SharedFunctionCurve[] {
	return [...localFunctionCurves, ...projectFunctionCurves];
}

/**
 * プロジェクトの定義をTimelineへ渡す境界。保存状態を変更せず、評価用の一覧だけを作る。
 * 子Sceneは各Scene自身の定義から構成し、Group/Transformのローカル定義を子へ継承しない。
 * Inline Nodes Effectの内部にも入らないため、その定義はプロジェクトから独立する。
 */
export function getTimelineScenesWithProjectFunctionCurves(scenes: TimelineScene[], functionCurves: readonly SharedFunctionCurve[]): TimelineScene[] {
	if (functionCurves.length === 0) return scenes;
	const visit = (layer: TimelineLayer): TimelineLayer => layer.layerType === 'folder' ? { ...layer, layers: layer.layers.map(visit) } : ({
		...layer,
		functionCurves: getAvailableFunctionCurves(layer.functionCurves, functionCurves),
		...(isTimelineContainerLayer(layer) ? { layers: layer.layers.map(visit) } : {}),
	});
	return scenes.map(scene => ({ ...scene, layers: scene.layers.map(visit) }));
}

export function validateProjectFunctionCurveName(functionCurves: readonly SharedFunctionCurve[], functionCurve: Pick<SharedFunctionCurve, 'id' | 'nameForReference'>): void {
	if (functionCurve.nameForReference.trim().length === 0) throw new Error('Function Curve nameForReference must not be empty');
	if (functionCurves.some(candidate => candidate.id !== functionCurve.id && candidate.nameForReference === functionCurve.nameForReference)) {
		throw new Error('Function Curve nameForReference must be unique within the project');
	}
}
