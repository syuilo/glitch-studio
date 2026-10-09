import type { ProjectState } from '../Project.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineKeyframeSelection } from './timeline-selection.ts';
import { getLayerParameterDefinition, resolveLayerParameter } from './timeline-scene.ts';
import { canEditKeyframesTimeline } from './keyframes-timeline.ts';
import { keyframeMoveBounds } from './timeline-selection.ts';

// 選択の検証と詳細編集で同じ対象を解決する。Inspectorを閉じても、編集できなくなったキーの選択は解除する。
export function getTimelineKeyframeEditTarget(
	state: Pick<ProjectState, 'visualModules'>, layer: TimelineLayer | null | undefined, selection: TimelineKeyframeSelection | null,
) {
	if (selection == null || selection.target === 'utterance') return null;
	if (layer == null || layer.id !== selection.layerId) return null;
	let binding: TimelineEffectParameterBinding;
	try { binding = resolveLayerParameter(state, layer, selection.target, selection.paramPath).value; } catch { return null; }
	if (binding?.inputSource !== 'keyframesTimelineInline') return null;
	const def = getLayerParameterDefinition(state, layer, selection.target, selection.paramPath);
	if (def == null || !canEditKeyframesTimeline(def, binding)) return null;
	const keyframes = binding.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x);
	const index = keyframes.findIndex(entry => entry.id === selection.keyframeId);
	if (index < 0) return null;
	const bounds = keyframeMoveBounds(keyframes, new Set([selection.keyframeId]), selection.keyframeId);
	return {
		selection, binding, def, keyframe: keyframes[index],
		previousKeyframe: keyframes[index - 1] ?? null,
		minX: keyframes[index].x + bounds.minDelta,
		maxX: keyframes[index].x + bounds.maxDelta,
	};
}
