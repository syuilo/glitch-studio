import { TimelineAudioRenderer } from '@gs/glitch-studio_audio-renderer/timeline-audio-renderer.ts';
import { AssetAudioReader } from '../audio/asset-audio-reader.ts';
import { MP4_AUDIO_SAMPLE_RATE } from './audio-export-settings.ts';
import type { StereoPcm } from '@gs/glitch-studio_audio-renderer/pcm.ts';
import type { SceneAudioClip } from '@gs/shared/timeline/scene-audio.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { VideoExportSettings } from './timeline-export.ts';

/** 書き出し専用のデコーダー・評価器。プレビューの再生位置や試聴音量を参照しない。 */
export class TimelineAudioExport {
	private reader: AssetAudioReader;
	private renderer: TimelineAudioRenderer;
	private nextFrame = 0;
	private startFrame: number;
	private totalFrames: number;

	constructor(assets: Asset[], private clips: SceneAudioClip[], settings: VideoExportSettings) {
		this.reader = new AssetAudioReader(assets);
		this.renderer = new TimelineAudioRenderer((...args) => this.reader.read(...args), (assetId, basis) => this.reader.getDurationMs(assetId, basis));
		// 開始時刻は整数msなので48kHzのサンプル境界と一致する。
		this.startFrame = settings.positionMs * (MP4_AUDIO_SAMPLE_RATE / 1000);
		this.totalFrames = Math.ceil((settings.endTimeMs - settings.positionMs) / 1000 * MP4_AUDIO_SAMPLE_RATE);
		if (!Number.isSafeInteger(this.startFrame + this.totalFrames)) throw new Error('Audio export range is too long.');
	}

	async renderUntil(timeSeconds: number, addAudio: (pcm: StereoPcm, timestamp: number) => Promise<void>, signal: AbortSignal) {
		const end = Math.min(this.totalFrames, Math.ceil(timeSeconds * MP4_AUDIO_SAMPLE_RATE));
		while (this.nextFrame < end) {
			signal.throwIfAborted();
			const count = Math.min(4096, end - this.nextFrame);
			const pcm = await this.renderer.renderClips(this.clips, this.startFrame + this.nextFrame, count, MP4_AUDIO_SAMPLE_RATE, true);
			signal.throwIfAborted();
			// 評価はプロジェクト時刻、ファイルのtimestampは出力範囲の先頭を0とする。
			await addAudio(pcm, this.nextFrame / MP4_AUDIO_SAMPLE_RATE);
			signal.throwIfAborted();
			this.nextFrame += count;
		}
	}

	dispose() { this.reader.dispose(); }
}
