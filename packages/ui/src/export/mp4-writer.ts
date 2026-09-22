import { BufferTarget, CanvasSource, Output, Mp4OutputFormat, Quality, canEncodeVideo } from 'mediabunny';
import type { VideoExportSettings } from './timeline-export.ts';

export async function createMp4Writer(canvas: OffscreenCanvas, settings: VideoExportSettings) {
	const quality = new Quality(settings.quality);
	if (!await canEncodeVideo('avc', { width: settings.width, height: settings.height, quality })) {
		throw new Error('H.264 encoding is unavailable at this resolution. Try a smaller resolution.');
	}
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const video = new CanvasSource(canvas, { codec: 'avc', quality });
	output.addVideoTrack(video, { frameRate: settings.fps });
	try {
		await output.start();
	} catch (error) {
		await output.cancel();
		throw error;
	}
	return {
		addFrame: (timestamp: number, duration: number) => video.add(timestamp, duration),
		async finalize() {
			video.close();
			await output.finalize();
		},
		getBuffer() {
			if (!target.buffer) throw new Error('MP4 output is not finalized.');
			return target.buffer;
		},
		cancel: () => output.cancel(),
	};
}
