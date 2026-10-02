import { AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Output, Mp4OutputFormat, Quality, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { MP4_AUDIO_BITRATE, MP4_AUDIO_SAMPLE_RATE } from './audio-export-settings.ts';
import type { StereoPcm } from '@gs/glitch-studio_audio-renderer/pcm.ts';
import type { VideoExportSettings } from './timeline-export.ts';

export async function createMp4Writer(canvas: OffscreenCanvas, settings: VideoExportSettings, includeAudio = false) {
	const quality = new Quality(settings.quality);
	if (!await canEncodeVideo('avc', { width: settings.width, height: settings.height, quality })) {
		throw new Error('H.264 encoding is unavailable at this resolution. Try a smaller resolution.');
	}
	const audioQuality = new Quality({ bitrate: MP4_AUDIO_BITRATE });
	if (includeAudio && !await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: MP4_AUDIO_SAMPLE_RATE, quality: audioQuality })) {
		throw new Error('AAC audio encoding is unavailable in this environment. Try exporting with a browser that supports AAC encoding.');
	}
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const video = new CanvasSource(canvas, { codec: 'avc', quality });
	output.addVideoTrack(video, { frameRate: settings.fps });
	const audio = includeAudio ? new AudioSampleSource({ codec: 'aac', quality: audioQuality }) : null;
	if (audio) output.addAudioTrack(audio);
	try {
		await output.start();
	} catch (error) {
		await output.cancel();
		throw error;
	}
	return {
		addFrame: (timestamp: number, duration: number) => video.add(timestamp, duration),
		async addAudio(channels: StereoPcm, timestamp: number) {
			if (!audio) throw new Error('MP4 audio track was not initialized.');
			const frames = channels[0].length;
			const data = new Float32Array(frames * 2);
			// planar形式はL全体→R全体の順。レイヤー加算後、出力境界で一度だけ飽和させる。
			// プレビューのスピーカー出力と同じく、過大な振幅をエンコーダーへ渡さない。
			for (let channel = 0; channel < 2; channel++) {
				for (let frame = 0; frame < frames; frame++) {
					const value = channels[channel][frame];
					data[channel * frames + frame] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
				}
			}
			const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: MP4_AUDIO_SAMPLE_RATE, timestamp });
			try { await audio.add(sample); } finally { sample.close(); }
		},
		async finalize() {
			video.close();
			audio?.close();
			await output.finalize();
		},
		getBuffer() {
			if (!target.buffer) throw new Error('MP4 output is not finalized.');
			return target.buffer;
		},
		cancel: () => output.cancel(),
	};
}
