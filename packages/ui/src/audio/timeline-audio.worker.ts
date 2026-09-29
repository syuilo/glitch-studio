import { TimelineAudioRenderer } from '@glitch/audio-renderer/timeline-audio-renderer.ts';
import { AssetAudioReader } from './asset-audio-reader.ts';
import type { Asset } from '@glitch/shared/types.ts';
import type { TimelineAudioLayer } from '@glitch/shared/timeline/types.ts';

type Start = { type: 'start'; assets: Asset[]; layers: TimelineAudioLayer[]; sampleRate: number; startFrame: number; endFrame: number };
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
		renderer = new TimelineAudioRenderer((...args) => reader.read(...args), assetId => reader.getDurationMs(assetId));
		frame = data.startFrame;
		return;
	}
	pending = pending.then(async () => {
		if (failed) return;
		const size = Math.round(settings.sampleRate / 4);
		const channels = [new Float32Array(size), new Float32Array(size)];
		for (let offset = 0; offset < size;) {
			const count = Math.min(size - offset, settings.endFrame - frame);
			const part = await renderer.render(settings.layers, frame, count, settings.sampleRate);
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
