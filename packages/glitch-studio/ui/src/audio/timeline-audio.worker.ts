import { TimelineAudioRenderer } from '@gs/subsystems_timeline_audio-renderer/timeline-audio-renderer.ts';
import { AssetAudioReader } from './asset-audio-reader.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { SceneAudioClip } from '@gs/subsystems_timeline_shared/scene-audio.ts';

type Start = { type: 'start'; assets: Asset[]; clips: SceneAudioClip[]; sampleRate: number; startFrame: number; endFrame: number };
let reader: AssetAudioReader;
let renderer: TimelineAudioRenderer;
let settings: Start;
let frame = 0;
let failed = false;
// 要求を直列化して同じデコーダーを同時にseekしない。停止・シークはWorker終了で中断する。
let pending = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<Start | { type: 'pull' }>) => {
	if (data.type === 'start') {
		settings = data;
		reader = new AssetAudioReader(data.assets);
		renderer = new TimelineAudioRenderer((...args) => reader.read(...args), (assetId, basis) => reader.getDurationMs(assetId, basis));
		frame = data.startFrame;
		return;
	}
	pending = pending.then(async () => {
		if (failed) return;
		const size = Math.round(settings.sampleRate / 4);
		const channels = [new Float32Array(size), new Float32Array(size)];
		for (let offset = 0; offset < size;) {
			const count = Math.min(size - offset, settings.endFrame - frame);
			const part = await renderer.renderClips(settings.clips, frame, count, settings.sampleRate);
			channels.forEach((channel, index) => channel.set(part[index], offset));
			frame = (frame + count) % settings.endFrame;
			offset += count;
		}
		self.postMessage({ type: 'pcm', channels }, { transfer: channels.map(channel => channel.buffer) });
	}).catch(error => {
		failed = true;
		reader?.dispose();
		self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	});
};
