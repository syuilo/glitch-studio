import { computed, inject, onScopeDispose, watch } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { prettyId } from '@gs/shared/utility/id.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.ts';
import { previewParameterContextKey, getPreviewParameterPosition, beginPreviewParameterBindingEdit, preparePreviewParameterDrag } from '../utility/preview-parameter-editing.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EditableParameterBinding } from '../types/parameter-edit.ts';
import type { AppContext } from '../AppContext.ts';

export function usePreviewParameterHandle(app: AppContext, props: {
	paramDef: ParameterDefinition; paramValue: EditableParameterBinding; paramPath: ParamPath;
	node?: VisualModuleEffectNode; label?: string; previewParameterGroup?: TimelineParameterTarget;
}) {
	const context = inject(previewParameterContextKey, null);
	const key = computed(() => context?.scope.value == null ? null
		: JSON.stringify([context.scope.value, props.node?.id ?? null, props.previewParameterGroup ?? null, props.paramPath]));
	const time = () => app.previewPlayback.state.value.mode === 'timeline'
		? app.previewPlayback.currentTimelineTime.value : app.previewParameterEditing.time.value;
	const endTime = () => {
		const scope = context?.scope.value;
		const sceneId = scope?.kind === 'timelineLayer' ? scope.sceneId
			: scope?.kind === 'visualModule' && 'sceneId' in scope.target ? scope.target.sceneId : null;
		if (sceneId == null) return 0;
		const scene = app.projectContext.stateManager.state.timelineScenes.value.find(candidate => candidate.id === sceneId);
		return scene == null ? 0 : getSceneDuration(scene);
	};
	// 固定値やXY以外のコントロールは時計を購読しない。Live Previewの毎フレームに
	// 全パラメータの可否判定やScene終端の探索を走らせる必要はない。
	const position = () => {
		if (!isParameterType(props.paramDef, 'vector') || props.paramDef.ui.control.controlType !== 'xy') return null;
		return props.paramValue.inputSource === 'keyframesTimelineInline'
			? getPreviewParameterPosition(props.paramDef, props.paramValue, time(), endTime())
			: getPreviewParameterPosition(props.paramDef, props.paramValue, 0, 0);
	};
	const editable = computed(() => context != null && key.value != null
		&& position() != null);
	const available = computed(() => {
		const scope = context?.scope.value;
		if (scope == null || !editable.value || props.node?.isBypass === true || app.renderEngine.isSuspended.value) return false;
		if (scope.kind === 'timelineLayer' && props.previewParameterGroup == null || scope.kind === 'visualModule' && props.node == null) return false;
		const playback = app.previewPlayback;
		if (scope.kind === 'livePreview') return context?.beginLivePreviewEdit != null && playback.visualModuleLivePreviewVisualModuleId.value === scope.visualModuleId;
		if (scope.kind === 'visualModule' && 'visualModuleId' in scope.target) return playback.visualModuleLivePreviewVisualModuleId.value === scope.target.visualModuleId;
		const sceneId = scope.kind === 'timelineLayer' ? scope.sceneId : 'sceneId' in scope.target ? scope.target.sceneId : null;
		return playback.state.value.mode === 'timeline' && app.activeSceneId.value === sceneId
			&& !playback.isTimelinePlaying.value && !playback.isTimelineBaking.value;
	});
	const enabled = computed(() => key.value != null && app.previewParameterEditing?.isEnabled(key.value) === true);
	let unregister: (() => void) | null = null;
	// Bindingの値そのものは購読し直さずgetterで読む。自分のドラッグ更新で登録が外れるのを防ぐ。
	watch([key, editable], ([currentKey, canEdit]) => {
		unregister?.();
		unregister = null;
		if (currentKey == null || !canEdit || context == null) return;
		unregister = app.previewParameterEditing.register({
			key: currentKey,
			label: () => [context.label.value, props.node == null ? null : `${props.node.displayName ?? props.node.effectId} ${prettyId(props.node.id)}`,
				props.label ?? props.paramDef.ui.label].filter(part => part != null && part !== '').join(' / '),
			available: () => available.value,
			position,
			begin() {
				const scope = context.scope.value;
				const binding = deepClone(props.paramValue);
				if (!available.value || scope == null || (binding.inputSource !== 'literal' && binding.inputSource !== 'keyframesTimelineInline')) return null;
				if (binding.inputSource === 'keyframesTimelineInline' && app.previewPlayback.state.value.mode === 'timeline') {
					app.previewPlayback.seekTimeline(Math.round(time()), true, 'precise');
				}
				const session = scope.kind === 'livePreview' ? context.beginLivePreviewEdit?.(props.paramPath) ?? null
					: beginPreviewParameterBindingEdit(app.projectContext.stateManager, scope, props.node?.id ?? null,
						props.previewParameterGroup ?? null, [...props.paramPath], binding.inputSource);
				return session == null ? null : preparePreviewParameterDrag(props.paramDef, binding,
					binding.inputSource === 'keyframesTimelineInline' ? time() : 0,
					binding.inputSource === 'keyframesTimelineInline' ? endTime() : 0, session);
			},
		});
	}, { immediate: true, flush: 'sync' });
	onScopeDispose(() => unregister?.());
	return { available, enabled, toggle: () => { if (available.value && key.value != null) app.previewParameterEditing.toggle(key.value); } };
}
