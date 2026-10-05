import { AudioFileReader } from '@gs/subsystems_audio_renderer/audio-file-reader.ts';
import { openAudioFile } from '@gs/subsystems_audio_renderer/audio-file.ts';
import { TimelineAudioRenderer } from '@gs/subsystems_timeline_audio-renderer/timeline-audio-renderer.ts';
import { createTimelineAudioInput } from '@gs/subsystems_timeline_audio-renderer/timeline-audio-input.ts';
import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { SceneAudioClip, SceneAudioSelection } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { TimelineAudioInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { isTimelineAudioOutputLayer } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { getTimelineScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { StereoPcm } from '@gs/subsystems_audio_shared/pcm.ts';
import type { AudioFile } from '@gs/subsystems_audio_renderer/audio-file.ts';

/** 描画用デコーダーの寿命とAssetの解決を所有する。再生Workerの時計やデコーダーは共有しない。 */
export class TimelineAudioInputs {
	private current?: { renderer: TimelineAudioRenderer; dispose: () => void };
	private scenes?: readonly TimelineScene[];
	private plans = new Map<string, SceneAudioClip[]>();
	private revision = 0;

	constructor(private assets: readonly Asset[] = [], private openFile: (file: Blob) => Promise<AudioFile> = openAudioFile) {}

	setAssets(assets: readonly Asset[]) {
		this.current?.dispose();
		this.current = undefined;
		this.assets = assets;
		this.revision++;
	}

	private getRenderer() {
		if (this.current) return this.current.renderer;
		const assets = this.assets;
		const reader = new AudioFileReader(async id => {
			const asset = assets.find(asset => asset.id === id);
			if (!asset) throw new Error(`Audio asset not found: ${id}`);
			try { return await this.openFile(asset.fileData); } catch (error) {
				throw new Error(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
		let pending: Promise<unknown> = Promise.resolve();
		let disposed = false;
		const renderer = new TimelineAudioRenderer((...args) => {
			// 複数のエフェクトは並行してprepareする。同じ素材のデコーダーを同時にseekしない。
			const signal = args[4];
			const result: Promise<StereoPcm> = pending.then(() => {
				// 待機中に不要になった要求で、最新フレームのデコードを遅らせない。
				signal?.throwIfAborted();
				if (disposed) throw new Error('Audio input has been disposed');
				return reader.read(...args);
			});
			pending = result.catch(() => {});
			return result;
		});
		this.current = { renderer, dispose: () => {
			disposed = true;
			// open/readの途中でdisposeすると、後から開いた資源が残るため完了後に解放する。
			void pending.then(() => reader.dispose());
		} };
		return renderer;
	}

	getInput(scenes: readonly TimelineScene[], sceneId: string, layerId: string, binding: TimelineAudioInputBinding, sceneTimeMs: number, isExport: boolean) {
		if (this.scenes !== scenes) {
			this.scenes = scenes;
			this.plans.clear();
			this.revision++;
		}
		let selection: SceneAudioSelection;
		if (binding.inputSource === 'layerAudio') {
			const source = getTimelineScene(scenes, sceneId).layers.find(layer => layer.id === binding.layerId);
			// 削除された参照は保存してUndoで復旧できるようにし、評価時は入力なしにする。
			if (!source || source.id === layerId || !isTimelineAudioOutputLayer(source)) return null;
			selection = { type: 'layer', layerId: source.id };
		} else {
			selection = { type: 'belowLayer', layerId };
		}
		const key = JSON.stringify([sceneId, selection.type, selection.layerId]);
		let clips = this.plans.get(key);
		if (!clips) {
			clips = getSceneAudioClips(scenes, sceneId, selection);
			this.plans.set(key, clips);
		}
		return createTimelineAudioInput(this.getRenderer(), clips, sceneTimeMs, `${this.revision}:${key}`, isExport);
	}

	dispose() {
		this.current?.dispose();
		this.current = undefined;
		this.plans.clear();
		this.scenes = undefined;
	}
}
