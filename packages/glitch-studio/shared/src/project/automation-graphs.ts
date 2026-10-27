import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';

/** 名前参照は先頭の定義を使う。ID参照では、同名のグローバル定義も選択できる。 */
export function getAvailableAutomationGraphs(localAutomationGraphs: readonly AutomationGraph[], projectAutomationGraphs: readonly AutomationGraph[]): AutomationGraph[] {
	return [...localAutomationGraphs, ...projectAutomationGraphs];
}

/**
 * プロジェクトの定義をTimelineへ渡す境界。保存状態を変更せず、評価用の一覧だけを作る。
 * 子Sceneは各Scene自身の定義から構成し、Group/Transformのローカル定義を子へ継承しない。
 * Inline Visual Moduleの内部にも入らないため、その定義はプロジェクトから独立する。
 */
export function getTimelineScenesWithProjectAutomationGraphs(scenes: TimelineScene[], automationGraphs: readonly AutomationGraph[]): TimelineScene[] {
	if (automationGraphs.length === 0) return scenes;
	const visit = (layer: TimelineLayer): TimelineLayer => layer.layerType === 'folder' ? { ...layer, layers: layer.layers.map(visit) } : ({
		...layer,
		automationGraphs: getAvailableAutomationGraphs(layer.automationGraphs, automationGraphs),
		...(isTimelineContainerLayer(layer) ? { layers: layer.layers.map(visit) } : {}),
	});
	return scenes.map(scene => ({ ...scene, layers: scene.layers.map(visit) }));
}

export function validateProjectAutomationGraphName(automationGraphs: readonly AutomationGraph[], graph: Pick<AutomationGraph, 'id' | 'nameForReference'>): void {
	if (graph.nameForReference.trim().length === 0) throw new Error('Automation Graph nameForReference must not be empty');
	if (automationGraphs.some(candidate => candidate.id !== graph.id && candidate.nameForReference === graph.nameForReference)) {
		throw new Error('Automation Graph nameForReference must be unique within the project');
	}
}
