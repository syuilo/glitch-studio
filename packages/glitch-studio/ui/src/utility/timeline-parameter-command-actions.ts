import { preferences } from '@/preferences.ts';
import { getTimelineParameterEditBinding } from '../commands/timeline-parameter-api.ts';
import type { TimelineParameterReference } from '../commands/timeline-parameter-api.ts';
import type { ProjectContext } from '../Project.ts';
import type { TimelineParameterEditInput } from './timeline-parameter-edit.ts';

/**
 * UIイベントを意味ごとのCommandへ渡す。完成後のBindingだけでは、加工式設定や
 * リセットを値の連続入力と区別できないため、イベントの境界で振り分ける。
 */
export function commitTimelineParameterEdit(
	manager: Pick<ProjectContext['stateManager'], 'state' | 'commit'>,
	input: TimelineParameterEditInput,
	mergeKey: string | null = null,
): void {
	const target: TimelineParameterReference = {
		sceneId: input.sceneId,
		layerId: input.layerId,
		parameterGroup: input.target ?? 'effect',
		parameterPath: input.paramPath,
	};
	const connectionTypePolicy = preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch';
	switch (input.edit.kind) {
		case 'reset': manager.commit('resetTimelineLayerParameter', target); return;
		case 'expressionModifier': manager.commit('setTimelineLayerParameterExpressionModifier', { ...target, expressionModifier: input.edit.value }, mergeKey); return;
		case 'addElement': manager.commit('insertTimelineLayerParameterArrayElement', target); return;
		case 'removeElement': manager.commit('removeTimelineLayerParameterArrayElement', { ...target, elementId: input.edit.elementId }); return;
		case 'inputSource':
		case 'structFields':
			// 入力方式の切替を、続く固定値・式の入力へ自動で統合しない。
			// structの一括更新は、プレビュー操作等の明示されたmergeKeyだけでまとめる。
			manager.commit('replaceTimelineLayerParameterBinding', { ...getTimelineParameterEditBinding(manager.state, input), connectionTypePolicy }, mergeKey);
			return;
		default: {
			const { binding, ...reference } = getTimelineParameterEditBinding(manager.state, input);
			manager.commit('setTimelineLayerParameterSource', { ...reference, source: binding, connectionTypePolicy }, mergeKey);
		}
	}
}
