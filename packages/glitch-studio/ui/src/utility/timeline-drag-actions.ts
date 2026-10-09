import { computed } from 'vue';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineGroupRange } from '@gs/subsystems_timeline_shared/layers/group/group.ts';
import { getTimelineClipEnd, getTimelineClipTrimBounds } from '@gs/subsystems_timeline_shared/timing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { assignPreparedSpeech, getVoicevoxUtterancePlacements } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-placement.ts';
import type { Ref } from 'vue';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectState, AppStateChange } from '@/Project.ts';
import type { COMMAND_DEFS } from '@/commands.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { TimelineSelection, TimelineClipSelection, TimelineKeyframeSelection } from './timeline-selection.ts';
import type { TimelineClipMediaInfo } from './timeline-clip-media.ts';
import type { TimelineSnapSettings, TimelineClipSnapSettings } from './timeline-snapping.ts';
import type { TimelineTickMode, TimelineTickSubdivisions } from './timeline-ticks.ts';
import type { TimelineViewport } from '@/composables/useTimelineViewport.ts';
import type { TimelineSelectionDrag } from '@/composables/useTimelineSelectionDrag.ts';
import type { getTimelineKeyframeEntries } from './timeline-keyframe-lanes.ts';
import { prepareTimelineClipMove } from './timeline-clip-move.ts';
import { prepareTimelineGroupMove } from './timeline-group.ts';
import { getTimelineClipSnapPoints, getTimelineSnapCandidates } from './timeline-snapping.ts';
import { getTimelineVisibleClipTicks } from './timeline-ticks.ts';
import { clipSelectionKey, keyframeSelectionKey, getTimelineStretchSelection, keyframeMoveBounds, getTimelineSnappingTimes } from './timeline-selection.ts';
import { createKeyframeStretch, stretchKeyframeX } from './timeline-keyframe-stretch.ts';
import { getVoicevoxSubtitleTrimBounds } from './voicevox-utterance-edit.ts';

type TimelineDragActionsOptions = {
	stateManager: Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;
	scene: TimelineScene;
	sceneLayers: Readonly<Ref<TimelineLayer[]>>;
	keyframeEntries: Readonly<Ref<ReturnType<typeof getTimelineKeyframeEntries>>>;
	selection: Ref<TimelineSelection>;
	mediaInfo: Readonly<Ref<ReadonlyMap<string, TimelineClipMediaInfo>>>;
	viewport: Pick<TimelineViewport, 'positionX' | 'rangeX' | 'tickCount' | 'ticksWithMinor'>;
	drag: Pick<TimelineSelectionDrag, 'canStart' | 'startSelectionMove'>;
	snapping: {
		settings: Readonly<Ref<TimelineSnapSettings>>;
		clipSettings: Readonly<Ref<TimelineClipSnapSettings>>;
		tickMode: Readonly<Ref<TimelineTickMode>>;
		tickSubdivisions: Readonly<Ref<TimelineTickSubdivisions>>;
		currentTime: Readonly<Ref<number>>;
	};
	selectLayer: (layer: TimelineLayer) => void;
	selectClip: (target: TimelineClipSelection, additive?: boolean) => void;
	selectKeyframe: (point: TimelineKeyframeSelection) => void;
	revealDetails: () => void;
	focusTimeline: () => void;
};

/** 操作開始時に対象・制約を確定し、共通ドラッグへCommandの適用方法を渡す。DOMの寿命は所有しない。 */
export function createTimelineDragActions(options: TimelineDragActionsOptions) {
	const { stateManager, scene, sceneLayers, keyframeEntries, selection, mediaInfo, drag,
		selectLayer, selectClip, selectKeyframe: onKeyframeSelected, revealDetails, focusTimeline } = options;
	const { positionX, rangeX, tickCount, ticksWithMinor } = options.viewport;
	const { settings: snapSettings, clipSettings: clipSnapSettings, tickMode, tickSubdivisions, currentTime: time } = options.snapping;
	const clipLayers = computed(() => sceneLayers.value.filter(layer => layer.layerType !== 'group'));

	function resolveClip(target: TimelineClipSelection) {
		const layer = clipLayers.value.find(layer => layer.id === target.layerId);
		const clip = layer?.clips.find(clip => clip.id === target.clipId);
		return layer && clip ? { layer, clip, target } : null;
	}

	function onGroupMoveStart(event: PointerEvent, layer: TimelineLayer) {
		if (layer.layerType !== 'group' || !drag.canStart(event)) return;
		selectLayer(layer);
		const range = getTimelineGroupRange(layer);
		if (!range) return;
		const initial = prepareTimelineGroupMove(stateManager.state, layer);
		const points = getTimelineClipSnapPoints({ ...range, contentOffsetMs: 0 }, { minDelta: initial.minDelta, maxDelta: initial.maxDelta }, clipSnapSettings.value);
		const excluded = new Set(flattenTimelineLayers([layer]).map(child => child.id));
		const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...clipLayers.value.filter(child => !excluded.has(child.id))
			.flatMap(child => child.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)]))], ticksWithMinor.value, [], time.value);
		drag.startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
			if (!sceneLayers.value.some(current => current.id === layer.id)) return false;
			stateManager.commit('moveTimelineGroup', { sceneId: scene.id, layerId: layer.id, deltaMs: delta, initial }, mergeKey);
			return true;
		});
	}

	function onClipMoveStart(event: PointerEvent, target: TimelineClipSelection) {
		if (!drag.canStart(event)) return;
		if (event.shiftKey || event.ctrlKey || event.metaKey) { selectClip(target, true); return; }
		if (selection.value.kind !== 'clips' || !selection.value.clips.some(clip => clipSelectionKey(clip) === clipSelectionKey(target))) selectClip(target);
		if (selection.value.kind !== 'clips') return;
		revealDetails();
		const targets = deepClone(selection.value.clips);
		const entries = targets.map(resolveClip).filter(entry => entry != null);
		const move = prepareTimelineClipMove(stateManager.state, scene, targets);
		const points = entries.flatMap(({ clip }) => getTimelineClipSnapPoints(clip,
			{ minDelta: move.minDelta, maxDelta: move.maxDelta }, clipSnapSettings.value));
		const selected = new Set(targets.map(clipSelectionKey));
		const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...clipLayers.value.flatMap(layer => layer.clips
			.filter(clip => !selected.has(clipSelectionKey({ layerId: layer.id, clipId: clip.id })))
			.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)]))], ticksWithMinor.value, [], time.value);
		const initialTargets = entries.map(({ target, clip }) => ({ ...target, initialStartMs: clip.startMs }));
		drag.startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
			if (targets.some(target => !resolveClip(target))) return false;
			stateManager.commit('moveTimelineClips', { sceneId: scene.id, clips: initialTargets, initialKeyframes: move.keyframes, deltaMs: delta }, mergeKey);
			return true;
		});
	}

	function onClipTrimStart(event: PointerEvent, target: TimelineClipSelection, edge: 'start' | 'end') {
		if (!drag.canStart(event)) return;
		const entry = resolveClip(target);
		if (!entry) return;
		selectClip(target);
		const { layer, clip } = entry;
		const media = layer.layerType === 'audio' || layer.layerType === 'video';
		const sourceDurationMs = 'assetId' in clip && typeof clip.assetId === 'string' ? mediaInfo.value.get(clip.assetId)?.durationMs : undefined;
		if (media && sourceDurationMs == null) return;
		const bounds = getTimelineClipTrimBounds(layer.clips, clip.id, edge, media || layer.layerType === 'scene', sourceDurationMs);
		if (bounds.minDelta > bounds.maxDelta) return;
		const points = getTimelineClipSnapPoints(clip, bounds, clipSnapSettings.value, edge);
		const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...clipLayers.value.flatMap(entry => entry.clips
			.filter(other => entry.id !== layer.id || other.id !== clip.id).flatMap(other => [other.startMs, getTimelineClipEnd(other)]))], ticksWithMinor.value, [], time.value);
		const initialTiming = { startMs: clip.startMs, durationMs: clip.durationMs, contentOffsetMs: clip.contentOffsetMs };
		drag.startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
			if (!resolveClip(target)) return false;
			stateManager.commit('editTimelineClipTiming', { sceneId: scene.id, ...target, edge, deltaMs: delta, initialTiming, sourceDurationMs }, mergeKey);
			return true;
		});
	}

	function onSubtitleTrimStart(event: PointerEvent, layerId: string, utteranceId: string, clipId: string) {
		if (!drag.canStart(event)) return;
		const layer = sceneLayers.value.find(layer => layer.id === layerId);
		if (layer?.layerType !== 'voicevox') return;
		const bounds = getVoicevoxSubtitleTrimBounds(layer.voicevox, layer.utterances, layer.clips, utteranceId, clipId);
		if (!bounds) return;
		const utterance = layer.utterances.find(key => key.id === utteranceId)!;
		onKeyframeSelected({ layerId, target: 'utterance', paramPath: ['utterances'], keyframeId: utteranceId });
		const resolveSpeech = createSpeechResolver(stateManager.state.generatedSpeech.value);
		const audioEnds = getVoicevoxUtterancePlacements(layer.voicevox, layer.utterances, layer.clips).flatMap(placement => {
			const speech = resolveSpeech(placement.request);
			const interval = speech && assignPreparedSpeech(placement, speech);
			return interval ? [Math.round(interval.endMs)] : [];
		});
		const otherTimes = [0, ...clipLayers.value.flatMap(layer => layer.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)])),
																						...keyframeEntries.value.map(entry => entry.time), ...audioEnds];
		const localTicks = snapSettings.value.localTicks ? getTimelineVisibleClipTicks(layer.clips, positionX.value, rangeX.value, tickCount.value, tickMode.value, tickSubdivisions.value)
			.flatMap(({ ticks }) => [...ticks.major, ...ticks.minor].map(tick => Math.round(tick.sceneTimeMs))) : [];
		const snapTimes = getTimelineSnapCandidates(snapSettings.value, otherTimes, ticksWithMinor.value, localTicks, time.value);
		if (utterance.subtitleDuration.mode !== 'specified') return;
		const initialDuration = utterance.subtitleDuration.durationMs;
		const initialTime = utterance.timeMs;
		const points = [{ time: bounds.endMs, minDelta: bounds.minDelta, maxDelta: bounds.maxDelta }];
		drag.startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
			const currentLayer = sceneLayers.value.find(layer => layer.id === layerId);
			if (currentLayer?.layerType !== 'voicevox') return false;
			const current = currentLayer.utterances.find(key => key.id === utteranceId);
			// 設定画面でFill・発話長モードへ変えた場合や、別操作でキーが移動・削除された場合はドラッグを続けない。
			if (!current || current.subtitleDuration.mode !== 'specified' || current.timeMs !== initialTime) return false;
			stateManager.commit('editVoicevoxLayer', { sceneId: scene.id, layerId, voicevox: currentLayer.voicevox,
																																														utterances: currentLayer.utterances.map(key => key.id === utteranceId ? { ...key, subtitleDuration: { mode: 'specified' as const, durationMs: initialDuration + delta } } : key) }, mergeKey);
			return true;
		});
	}

	function onKeyframeMoveStart(event: PointerEvent, point: TimelineKeyframeSelection) {
		if (!drag.canStart(event)) return;
		const key = keyframeSelectionKey(point);
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			const current = selection.value.kind === 'keyframes' ? selection.value.keyframes : [];
			selection.value = { kind: 'keyframes', keyframes: current.some(entry => keyframeSelectionKey(entry) === key) ? current.filter(entry => keyframeSelectionKey(entry) !== key) : [...current, point] };
			focusTimeline();
			revealDetails();
			return;
		}
		// 発話は絶対時刻のイベントなので、Shiftの時間伸縮には含めず共通移動だけを行う。
		const canStretch = point.target !== 'utterance' && (selection.value.kind !== 'keyframes' || !selection.value.keyframes.some(entry => entry.target === 'utterance'));
		const stretchSelection = event.shiftKey && canStretch ? getTimelineStretchSelection(keyframeEntries.value.map(entry => entry.selection), selection.value, point) : [];
		const stretchKeys = new Set(stretchSelection.map(keyframeSelectionKey));
		const stretchEntries = keyframeEntries.value.filter(entry => stretchKeys.has(keyframeSelectionKey(entry.selection)));
		const laneEntries = stretchEntries.filter(entry => entry.selection.target === point.target && paramPathKey(entry.selection.paramPath) === paramPathKey(point.paramPath));
		const stretch = event.shiftKey && canStretch ? createKeyframeStretch(laneEntries.map(entry => ({ id: entry.selection.keyframeId, x: entry.x })), point.keyframeId,
			stretchEntries.map(entry => {
				const ids = new Set(stretchSelection.filter(point => point.target === entry.selection.target && paramPathKey(point.paramPath) === paramPathKey(entry.selection.paramPath)).map(point => point.keyframeId));
				return { x: entry.x, ...keyframeMoveBounds(entry.keyframes, ids, entry.selection.keyframeId) };
			})) : null;
		if (stretch != null) {
			// 同じレイヤーの選択済みキーを、ドラッグしたレーンの選択範囲を基準に変形する。
			selection.value = { kind: 'keyframes', keyframes: stretchSelection };
		} else if (selection.value.kind !== 'keyframes' || !selection.value.keyframes.some(entry => keyframeSelectionKey(entry) === key)) onKeyframeSelected(point);
		const current = selection.value;
		if (current.kind !== 'keyframes') return;
		revealDetails();
		const selected = new Set(current.keyframes.map(keyframeSelectionKey));
		const entries = keyframeEntries.value.filter(entry => selected.has(keyframeSelectionKey(entry.selection)));
		const otherTimes = [0, ...clipLayers.value.flatMap(entry => entry.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)])),
																						...keyframeEntries.value.filter(entry => !selected.has(keyframeSelectionKey(entry.selection))).map(entry => entry.time)];
		const affectedLayerIds = new Set(entries.map(entry => entry.selection.layerId));
		const candidatesByLayer = new Map(sceneLayers.value.filter(layer => affectedLayerIds.has(layer.id)).map(layer => {
			// キーはScene時刻のまま、所属レイヤーの各クリップに描いた目盛りへ吸着させる。
			// 空白区間にはローカル目盛りがなく、別レイヤーのクリップも候補に含めない。
			const localTimes = snapSettings.value.localTicks ? getTimelineVisibleClipTicks(
				layer.layerType === 'group' ? [] : layer.clips, positionX.value, rangeX.value, tickCount.value, tickMode.value, tickSubdivisions.value,
			).flatMap(({ ticks }) => [...ticks.major, ...ticks.minor].map(tick => tick.sceneTimeMs)).toSorted((a, b) => a - b) : [];
			return [layer.id, getTimelineSnapCandidates(snapSettings.value, otherTimes, ticksWithMinor.value, localTimes, time.value)];
		}));
		const points = entries.filter(entry => stretch == null || keyframeSelectionKey(entry.selection) === key).map(entry => {
			const ids = new Set(current.keyframes.filter(point => point.layerId === entry.selection.layerId && point.target === entry.selection.target && paramPathKey(point.paramPath) === paramPathKey(entry.selection.paramPath)).map(point => point.keyframeId));
			const bounds = stretch ?? keyframeMoveBounds(entry.keyframes, ids, entry.selection.keyframeId);
			return { time: entry.time, minDelta: bounds.minDelta, maxDelta: bounds.maxDelta, snapTimes: candidatesByLayer.get(entry.selection.layerId) ?? [] };
		});
		const positions = entries.map(entry => ({ ...entry.selection, x: entry.x }));
		const movedX = (x: number, delta: number) => Math.round(stretch == null ? x + delta : stretchKeyframeX(x, stretch, delta));
		drag.startSelectionMove(event, points, [], (delta, mergeKey) => {
			const available = new Set(keyframeEntries.value.map(entry => keyframeSelectionKey(entry.selection)));
			if (positions.some(position => !available.has(keyframeSelectionKey(position)))) return false;
			stateManager.commit('moveTimelineKeyframes', { sceneId: scene.id, positions: positions.map(position => ({ ...position, x: movedX(position.x, delta) })) }, mergeKey);
			return true;
		}, delta => getTimelineSnappingTimes(entries.map(entry => ({
			time: entry.time + movedX(entry.x, delta) - entry.x,
			minDelta: 0, maxDelta: 0, snapTimes: candidatesByLayer.get(entry.selection.layerId) ?? [],
		})), [], 0));
	}

	return { resolveClip, onGroupMoveStart, onClipMoveStart, onClipTrimStart, onSubtitleTrimStart, onKeyframeMoveStart };
}
