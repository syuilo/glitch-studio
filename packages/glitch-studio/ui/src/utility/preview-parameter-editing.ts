import { computed, ref, shallowRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { evaluateKeyframesTimeline } from '@gs/shared/keyframes/keyframes-timeline-evaluator.ts';
import { canEditKeyframesTimeline, insertInlineKeyframe, updateInlineKeyframe } from './keyframes-timeline.ts';
import type { ComputedRef, InjectionKey } from 'vue';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModuleTarget } from './visual-module-target.ts';
import type { EditableParameterBinding, ValueParameterEdit } from '../types/parameter-edit.ts';
import type { ProjectContext } from '../Project.ts';
import type { PreviewViewportHandle, PreviewViewportEdit } from './preview-viewport.ts';

export type PreviewParameterPoint = [number, number];
type PreviewParameterValueEdit = Extract<ValueParameterEdit, { kind: 'literal' | 'keyframesTimelineInline' }>;
export type PreviewParameterBindingEdit = {
	readonly active: boolean;
	update(edit: PreviewParameterValueEdit): void;
	finish(): void;
	cancel(): void;
};

// 所有者の所在はUIだけが知る。エフェクトやVisual Moduleの保存形式には持ち込まない。
export type PreviewParameterScope =
	| { kind: 'visualModule'; target: VisualModuleTarget }
	| { kind: 'timelineLayer'; sceneId: string; layerId: string }
	| { kind: 'livePreview'; visualModuleId: string };
export const previewParameterContextKey: InjectionKey<{
	scope: ComputedRef<PreviewParameterScope | null>;
	label: ComputedRef<string>;
	beginLivePreviewEdit?: (path: ParamPath) => PreviewParameterBindingEdit;
}> = Symbol('previewParameterContext');

export type PreviewParameterDrag = {
	readonly active: boolean;
	initialPosition: PreviewParameterPoint;
	update(position: PreviewParameterPoint): void;
	finish(): void;
	cancel(): void;
};
export type PreviewParameterHandle = {
	key: string;
	label(): string;
	available(): boolean;
	position(): PreviewParameterPoint | null;
	begin(): PreviewParameterDrag | null;
};

/** 同じパラメータを複数パネルで表示していても、有効状態とハンドルを共有する。 */
export class PreviewParameterEditingController {
	public readonly time = ref(0);
	private registrations = shallowRef(new Map<string, Map<object, PreviewParameterHandle | PreviewViewportHandle>>());
	private enabled = shallowRef(new Set<string>());
	private readonly activeHandles = computed(() => [...this.enabled.value].flatMap(key => {
		const handle = [...(this.registrations.value.get(key)?.values() ?? [])].findLast(candidate => candidate.available());
		return handle != null ? [handle] : [];
	}));
	public readonly handles = computed(() => this.activeHandles.value.filter((handle): handle is PreviewParameterHandle => !('kind' in handle)).filter(handle => handle.position() != null));
	public readonly viewport = computed(() => this.activeHandles.value.find((handle): handle is PreviewViewportHandle => 'kind' in handle) ?? null);

	public register(handle: PreviewParameterHandle | PreviewViewportHandle): () => void {
		const token = {};
		const entries = new Map(this.registrations.value.get(handle.key));
		entries.set(token, handle);
		this.registrations.value = new Map(this.registrations.value).set(handle.key, entries);
		return () => {
			const remaining = new Map(this.registrations.value.get(handle.key));
			remaining.delete(token);
			const registrations = new Map(this.registrations.value);
			if (remaining.size > 0) registrations.set(handle.key, remaining);
			else { registrations.delete(handle.key); this.disable(handle.key); }
			this.registrations.value = registrations;
		};
	}

	public isEnabled(key: string): boolean { return this.enabled.value.has(key); }
	public toggle(key: string): void {
		if (this.isEnabled(key)) this.disable(key);
		else if (this.registrations.value.has(key)) {
			const isViewport = (candidateKey: string) => [...(this.registrations.value.get(candidateKey)?.values() ?? [])].some(handle => 'kind' in handle);
			// 全面のドラッグ・ホイールを受け取る表示範囲は一つだけにする。
			// 位置ハンドルと混在させず、ボタンの状態と実際の操作対象を一致させる。
			// バイパス等で一時的に操作できない表示範囲も解除する。復帰時に
			// 過去の全面操作が位置ハンドルへ重なって再出現するのを防ぐ。
			this.enabled.value = isViewport(key) || [...this.enabled.value].some(isViewport) ? new Set([key]) : new Set(this.enabled.value).add(key);
		}
	}
	private disable(key: string): void {
		const enabled = new Set(this.enabled.value);
		enabled.delete(key);
		this.enabled.value = enabled;
	}
	public clear(): void { this.enabled.value = new Set(); }
}

export function getPreviewParameterPosition(definition: ParameterDefinition, binding: EditableParameterBinding, time: number, endTime: number): PreviewParameterPoint | null {
	if (!isParameterType(definition, 'vector') || definition.ui.control.controlType !== 'xy') return null;
	// ハンドルは数値欄と同じ加工前の基準値を表す。任意の加工式や後段の変形は逆算しない。
	const value = getPreviewParameterBaseValue(definition, binding, time, endTime);
	return Array.isArray(value) && value.length === 2 && value.every(component => typeof component === 'number' && Number.isFinite(component))
		? [value[0], value[1]] : null;
}

export function getPreviewParameterBaseValue(definition: ParameterDefinition, binding: EditableParameterBinding, time: number, endTime: number): any {
	return binding.inputSource === 'literal' ? binding.value
		: binding.inputSource === 'keyframesTimelineInline' && canEditKeyframesTimeline(definition, binding)
			? evaluateKeyframesTimeline(binding.keyframesTimeline, binding, time, endTime, definition.defaultValue.value) : null;
}

/** 保存先ごとのCommandを選ぶ。ドラッグ中も通常の編集と同じ変更通知・レンダラー同期を通す。 */
export function beginPreviewParameterBindingEdit(manager: ProjectContext['stateManager'], scope: Exclude<PreviewParameterScope, { kind: 'livePreview' }>,
	nodeId: string | null, group: TimelineParameterTarget | null, paramPath: ParamPath, inputSource: 'literal' | 'keyframesTimelineInline'): PreviewParameterBindingEdit | null {
	if (scope.kind === 'timelineLayer') {
		if (group == null) return null;
		const session = manager.beginEdit('editTimelineLayerParam');
		return { get active() { return session.active; }, finish: session.finish, cancel: session.cancel,
			update: edit => session.update({ sceneId: scope.sceneId, layerId: scope.layerId, target: group, paramPath, edit }) };
	}
	if (nodeId == null) return null;
	const target = { ...scope.target, nodeId, paramPath };
	if (inputSource === 'literal') {
		const session = manager.beginEdit('updateParamAsLiteral');
		return { get active() { return session.active; }, finish: session.finish, cancel: session.cancel,
			update: edit => { if (edit.kind === 'literal') session.update({ ...target, value: edit.value }); } };
	}
	const session = manager.beginEdit('updateParamAsKeyframesTimelineInline');
	return { get active() { return session.active; }, finish: session.finish, cancel: session.cancel,
		update: edit => { if (edit.kind === 'keyframesTimelineInline') session.update({ ...target, value: edit.value }); } };
}

/** 表示範囲の中心・倍率を、保存先ごとに一つのCommandとして更新する。 */
export function beginPreviewViewportBindingEdit(manager: ProjectContext['stateManager'], scope: Exclude<PreviewParameterScope, { kind: 'livePreview' }>,
	nodeId: string | null, group: TimelineParameterTarget | null, paramPath: ParamPath): PreviewViewportEdit | null {
	if (scope.kind === 'timelineLayer') {
		if (group == null) return null;
		const session = manager.beginEdit('editTimelineLayerParam');
		return { get active() { return session.active; }, finish: session.finish, cancel: session.cancel,
			update: fields => session.update({ sceneId: scope.sceneId, layerId: scope.layerId, target: group, paramPath, edit: { kind: 'structFields', fields } }) };
	}
	if (nodeId == null) return null;
	const target = { ...scope.target, nodeId, paramPath };
	const session = manager.beginEdit('updateParamFields');
	return { get active() { return session.active; }, finish: session.finish, cancel: session.cancel,
		update: fields => session.update({ ...target, fields }) };
}

export function preparePreviewParameterDrag(definition: ParameterDefinition, binding: EditableParameterBinding, time: number, endTime: number,
	session: PreviewParameterBindingEdit): PreviewParameterDrag | null {
	const initialPosition = getPreviewParameterPosition(definition, binding, time, endTime);
	if (initialPosition == null) { session.cancel(); return null; }
	const edit = preparePreviewParameterValueEdit(definition, binding, time, endTime);
	if (edit == null) { session.cancel(); return null; }
	let changed = false;
	let updated = false;
	return {
		get active() { return session.active; }, initialPosition,
		update(position) {
			changed = position.some((value, axis) => value !== initialPosition[axis]);
			if (!changed && !updated) return;
			updated = true;
			session.update(edit(position));
		},
		finish() { if (changed) session.finish(); else session.cancel(); },
		cancel: session.cancel,
	};
}

/** キーの挿入時刻とIDを一操作で固定し、位置ハンドルと表示範囲の編集で共有する。 */
export function preparePreviewParameterValueEdit(definition: ParameterDefinition, binding: EditableParameterBinding, time: number, endTime: number): ((value: any) => PreviewParameterValueEdit) | null {
	if (binding.inputSource === 'literal') return value => ({ kind: 'literal', value });
	else if (binding.inputSource === 'keyframesTimelineInline') {
		// 通常のTimelineキーは整数ms。正規化・終端基準のキーでは、その再生座標へ換算する。
		const lastTime = Math.max(0, ...binding.keyframesTimeline.keyframes.map(point => point.x));
		const scale = binding.keyframesTimeline.isNormalized ? binding.trimmedDurationMs ?? 1000 : 1;
		const keyTime = binding.offsetMode === 'end' ? (time - endTime) / scale + lastTime : time / scale;
		const inserted = insertInlineKeyframe(deepClone(binding), definition, Math.max(0, binding.keyframesTimeline.isNormalized ? keyTime : Math.round(keyTime)), endTime);
		if (inserted == null) return null;
		return value => ({ kind: 'keyframesTimelineInline', value: updateInlineKeyframe(inserted.value, definition, inserted.keyframeId, { value }) ?? inserted.value });
	}
	return null;
}
