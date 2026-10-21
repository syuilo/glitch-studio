import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Ref } from 'vue';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectState, AppStateChange } from '@/Project.ts';
import type { COMMAND_DEFS } from '@/commands.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { TimelineSelection } from './timeline-selection.ts';
import type { TimelineClipboard } from './timeline-editor-state.ts';
import type { TimelineClipClipboard } from './timeline-clip-clipboard.ts';
import type { TimelineClipMediaInfo, TimelineClipSourceDurations } from './timeline-clip-media.ts';
import { duplicateTimelineLayers } from './timeline-container.ts';
import { copyTimelineClips, prepareTimelineClipPaste, canPasteTimelineClips } from './timeline-clip-clipboard.ts';
import { copyTimelineKeyframes, prepareTimelineKeyframePaste, getPastedTimelineKeySelection } from './timeline-keyframe-clipboard.ts';
import { getSelectedTimelineLayerId } from './timeline-editor-state.ts';

type TimelineSelectionEditActionsOptions = {
	stateManager: Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;
	scene: TimelineScene;
	sceneLayers: Readonly<Ref<TimelineLayer[]>>;
	selection: Ref<TimelineSelection>;
	selectedLayer: Readonly<Ref<TimelineLayer | null>>;
	clipboard: { value: TimelineClipboard | null };
	currentTime: Readonly<Ref<number>>;
	isActive: () => boolean;
	inspectMedia: (asset: Asset) => Promise<TimelineClipMediaInfo>;
	readLayerMediaDurations: (layer: TimelineLayer) => Promise<TimelineClipSourceDurations | null>;
	selectLayer: (layer: TimelineLayer) => void;
	focusTimeline: () => void;
	reportError: (error: unknown) => void;
};

/** 選択対象のコピー・切り取り・削除と、貼り付けの準備・再確認・Command適用を担当する。DOMイベントは呼び出し側で扱う。 */
export function createTimelineSelectionEditActions(options: TimelineSelectionEditActionsOptions) {
	const { stateManager, scene, sceneLayers, selection, selectedLayer, clipboard, currentTime,
		isActive, inspectMedia, readLayerMediaDurations, selectLayer, focusTimeline, reportError } = options;

	function canCopy() {
		if (!isActive()) return false;
		const current = selection.value;
		return current.kind === 'keyframes' ? current.keyframes.length > 0 : current.kind === 'clips' ? current.clips.length > 0 : current.ids.length === 1 && selectedLayer.value != null;
	}

	function copySelection() {
		if (!canCopy()) return false;
		const current = selection.value;
		// コピーに失敗した場合は以前の内容を維持し、切り取りでも削除へ進まない。
		const content: TimelineClipboard | null = current.kind === 'keyframes' ? copyTimelineKeyframes(stateManager.state, scene, current.keyframes)
			: current.kind === 'clips' ? copyTimelineClips(scene, current.clips)
			: selectedLayer.value != null ? { kind: 'layer', layer: deepClone(selectedLayer.value) } : null;
		if (content == null) return false;
		clipboard.value = content;
		return true;
	}

	function canPaste() {
		return isActive() && clipboard.value != null && (clipboard.value.kind !== 'layer' || selection.value.kind !== 'clips');
	}

	function canDelete() {
		if (!isActive()) return false;
		const current = selection.value;
		return current.kind === 'keyframes' ? current.keyframes.length > 0 : current.kind === 'clips' ? current.clips.length > 0 : current.ids.length > 0;
	}

	function deleteSelection() {
		if (!canDelete()) return;
		const current = selection.value;
		if (current.kind === 'keyframes') {
			const layerId = getSelectedTimelineLayerId(current);
			stateManager.commit('removeTimelineKeyframes', { sceneId: scene.id, keyframes: deepClone(current.keyframes) });
			selection.value = { kind: 'layers', ids: layerId != null ? [layerId] : [] };
		} else if (current.kind === 'clips') {
			stateManager.commit('removeTimelineClips', { sceneId: scene.id, clips: deepClone(current.clips) });
			selection.value = { kind: 'clips', clips: [] };
		} else {
			stateManager.commit('removeTimelineLayers', { sceneId: scene.id, layerIds: [...current.ids] });
			selection.value = { kind: 'layers', ids: [] };
		}
		focusTimeline();
	}

	function canCut() { return canCopy() && canDelete(); }

	function cutSelection() {
		if (canCut() && copySelection()) deleteSelection();
	}

	async function pasteClips(content: TimelineClipClipboard) {
		if (!isActive()) return;
		// シーク位置は操作時点で固定し、素材情報の読み込み中に再生が進んでも位置を変えない。
		const clips = prepareTimelineClipPaste(scene, content, currentTime.value);
		if (!clips) return;
		try {
			const sources = clips.flatMap(({ layerId, clip }) => {
				const layer = findTimelineLayer(scene.layers, layerId)!;
				if (layer.layerType !== 'audio' && layer.layerType !== 'video') return [];
				const asset = 'assetId' in clip ? stateManager.state.assets.value.find(asset => asset.id === clip.assetId) : null;
				if (!asset) throw new Error('Missing media');
				return [{
					layerId,
					clipId: clip.id,
					asset,
					fileSource: asset.fileData,
				}];
			});
			const durations = await Promise.all(sources.map(async ({ layerId, clipId, asset }) => ({ layerId, clipId, durationMs: (await inspectMedia(asset)).durationMs })));
			if (!isActive()) return;
			if (sources.some(({ asset, fileSource }) => !stateManager.state.assets.value.includes(asset) || asset.fileData !== fileSource)) return;
			// 読み込み待ちの間にクリップが追加・移動されても、重なる場合は履歴を作らず終了する。
			if (!canPasteTimelineClips(scene, clips)) return;
			const sourceDurationsMs: TimelineClipSourceDurations = Object.create(null);
			for (const { layerId, clipId, durationMs } of durations) (sourceDurationsMs[layerId] ??= Object.create(null))[clipId] = durationMs;
			stateManager.commit('pasteTimelineClips', { sceneId: scene.id, clips, sourceDurationsMs });
			selection.value = { kind: 'clips', clips: clips.map(({ layerId, clip }) => ({ layerId, clipId: clip.id })) };
			focusTimeline();
		} catch (error) { reportError(error); }
	}

	async function paste() {
		const content = clipboard.value;
		if (!canPaste() || content == null || !isActive()) return;
		if (content.kind === 'keyframes') {
			const keyframes = prepareTimelineKeyframePaste(stateManager.state, scene, content, currentTime.value);
			if (!keyframes) return;
			stateManager.commit('pasteTimelineKeyframes', { sceneId: scene.id, keyframes });
			selection.value = { kind: 'keyframes', keyframes: keyframes.map(getPastedTimelineKeySelection) };
			focusTimeline();
		} else if (content.kind === 'clips') {
			await pasteClips(content);
		} else {
			const sourceLayerId = content.layer.id;
			const [layer] = duplicateTimelineLayers([content.layer]);
			// レイヤー全体の複製ではScene上のキーと全クリップの位置関係をそのまま保持する。
			try {
				const initialLayers = sceneLayers.value;
				const sourceDurationsMs = await readLayerMediaDurations(layer);
				if (!isActive() || sceneLayers.value !== initialLayers) return;
				stateManager.commit('pasteTimelineLayer', {
					sceneId: scene.id,
					layer,
					sourceLayerId,
					sourceDurationsMs,
				});
			} catch (error) { reportError(error); return; }
			selectLayer(layer);
		}
	}

	return {
		canCut,
		cutSelection,
		canDelete,
		deleteSelection,
		canCopy,
		copySelection,
		canPaste,
		paste,
	};
}
