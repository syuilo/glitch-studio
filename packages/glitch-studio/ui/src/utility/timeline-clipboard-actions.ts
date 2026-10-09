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
import { duplicateTimelineLayers } from './timeline-group.ts';
import { copyTimelineClips, prepareTimelineClipPaste, canPasteTimelineClips } from './timeline-clip-clipboard.ts';
import { copyTimelineKeyframes, prepareTimelineKeyframePaste, getPastedTimelineKeySelection } from './timeline-keyframe-clipboard.ts';

type TimelineClipboardActionsOptions = {
	stateManager: Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;
	scene: TimelineScene;
	sceneLayers: Readonly<Ref<TimelineLayer[]>>;
	selection: Ref<TimelineSelection>;
	selectedLayer: Readonly<Ref<TimelineLayer | null>>;
	clipboard: { value: TimelineClipboard | null };
	currentTime: Readonly<Ref<number>>;
	isActive: () => boolean;
	inspectMedia: (asset: Asset) => Promise<TimelineClipMediaInfo>;
	readLayerMediaDurations: (layer: TimelineLayer) => Promise<TimelineClipSourceDurations | undefined>;
	selectLayer: (layer: TimelineLayer) => void;
	focusTimeline: () => void;
	reportError: (error: unknown) => void;
};

/** コピー内容のスナップショットと貼り付けの準備・再確認・Command適用を担当する。キー入力は呼び出し側で扱う。 */
export function createTimelineClipboardActions(options: TimelineClipboardActionsOptions) {
	const { stateManager, scene, sceneLayers, selection, selectedLayer, clipboard, currentTime,
		isActive, inspectMedia, readLayerMediaDurations, selectLayer, focusTimeline, reportError } = options;

	function canCopy() {
		return selection.value.kind !== 'layers' || selectedLayer.value != null;
	}

	function copySelection() {
		const current = selection.value;
		if (current.kind === 'keyframes') clipboard.value = copyTimelineKeyframes(stateManager.state, scene, current.keyframes);
		else if (current.kind === 'clips') clipboard.value = copyTimelineClips(scene, current.clips);
		else if (selectedLayer.value != null) {
			// コピー後の編集がクリップボードの内容に影響しないよう、ここでスナップショットを作る。
			clipboard.value = { kind: 'layer', layer: deepClone(selectedLayer.value) };
		}
	}

	function canPaste() {
		return clipboard.value != null && (clipboard.value.kind !== 'layer' || selection.value.kind !== 'clips');
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
				const asset = 'assetId' in clip ? stateManager.state.assets.value.find(asset => asset.id === clip.assetId) : undefined;
				if (!asset) throw new Error('Missing media');
				return [{ layerId, clipId: clip.id, asset, blob: asset.fileData }];
			});
			const durations = await Promise.all(sources.map(async ({ layerId, clipId, asset }) => ({ layerId, clipId, durationMs: (await inspectMedia(asset)).durationMs })));
			if (!isActive()) return;
			if (sources.some(({ asset, blob }) => !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob)) return;
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
				stateManager.commit('pasteTimelineLayer', { sceneId: scene.id, layer, sourceLayerId, sourceDurationsMs });
			} catch (error) { reportError(error); return; }
			selectLayer(layer);
		}
	}

	return { canCopy, copySelection, canPaste, paste };
}
