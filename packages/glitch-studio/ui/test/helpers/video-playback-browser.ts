import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import { openVideoSource } from '@gs/shared/media/video-source.ts';
import { getTimelineMediaSourceTime } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { renderExportFrames } from '../../src/export/timeline-export.ts';
import { createMp4Writer } from '../../src/export/mp4-writer.ts';

export async function run() {
	const canvas = new OffscreenCanvas(1280, 720);
	const context = canvas.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 2_000_000 }) });
	output.addVideoTrack(video, { frameRate: 60 });
	await output.start();
	try {
		for (let index = 0; index < 90; index++) {
			// 各フレームの明度を変え、時刻だけでなくデコード後の画素も確認する。
			const brightness = 20 + index * 2;
			context.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
			context.fillRect(0, 0, canvas.width, canvas.height);
			await video.add(index / 60, 1 / 60);
		}
		video.close();
		await output.finalize();
	} catch (error) { await output.cancel(); throw error; }
	const source = openVideoSource(new Blob([target.buffer!], { type: 'video/mp4' }));
	const completed: string[] = [];
	try {
		for (const time of [1.5, 1.48, 1.4, 1.2, 0.9, 0.5, 0.1]) {
			const sample = await source.getSample(time, true);
			if (!sample) throw new Error(`No reverse sample at ${time}`);
			try {
				const expectedIndex = Math.ceil(time * 60 - 1e-6) - 1;
				if (Math.abs(sample.timestamp - expectedIndex / 60) > 1e-5) throw new Error(`Unexpected timestamp ${sample.timestamp} at ${time}`);
				sample.draw(context, 0, 0, canvas.width, canvas.height);
				const actual = context.getImageData(0, 0, 1, 1).data[0];
				if (Math.abs(actual - (20 + expectedIndex * 2)) > 4) throw new Error(`Unexpected reverse pixel ${actual} at ${time}`);
			} finally { sample.close(); }
		}
		completed.push('reverse decoding and pixels');
		const settings = {
			format: 'mp4' as const,
			quality: 'medium' as const,
			width: 1280,
			height: 720,
			fps: 60,
			positionMs: 0,
			endTimeMs: 1500,
		};
		const clip = {
			startMs: 0,
			sourceInMs: 0,
			sourceOutMs: 1500,
			playbackRate: -1,
			loop: false,
		};
		const writer = await createMp4Writer(canvas, settings);
		const progress: number[] = [];
		try {
			await renderExportFrames(settings, {
				signal: new AbortController().signal,
				async render(frame) {
					const sample = await source.getSample(getTimelineMediaSourceTime(clip, frame.timeMs) / 1000, true);
					if (!sample) throw new Error(`No export sample at ${frame.timeMs}`);
					try { sample.draw(context, 0, 0, canvas.width, canvas.height); } finally { sample.close(); }
				},
				addFrame: frame => writer.addFrame(frame.timestamp, frame.duration),
				finalize: () => writer.finalize(),
				onProgress: value => { progress.push(value.completedFrames); },
			});
			if (progress[0] !== 1 || progress.at(-1) !== 90 || writer.getBuffer().byteLength === 0) throw new Error('Export did not complete');
			const exported = openVideoSource(new Blob([writer.getBuffer()], { type: 'video/mp4' }));
			try {
				for (const [time, expected] of [[0, 198], [1.4, 30]]) {
					const sample = await exported.getSample(time);
					if (!sample) throw new Error('Missing exported frame');
					try { sample.draw(context, 0, 0, canvas.width, canvas.height); } finally { sample.close(); }
					if (Math.abs(context.getImageData(0, 0, 1, 1).data[0] - expected) > 5) throw new Error(`Export pixels out of order at ${time}`);
				}
			} finally { exported.dispose(); }
			completed.push('reverse MP4 export and decoded output');
		} catch (error) { await writer.cancel(); throw error; }
	} finally { source.dispose(); }
	return completed;
}
