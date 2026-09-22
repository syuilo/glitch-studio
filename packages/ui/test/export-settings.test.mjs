import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustExportResolution, estimateExportBytes, formatExportTime, parseExportTime, scaleExportResolution } from '../src/export/export-settings.ts';
import { validateExportSettings } from '../src/export/timeline-export.ts';

// ミリ秒を失わず、24時間を越えるタイムラインも時刻として扱う。
test('round trips millisecond timecodes including more than 24 hours', () => {
	assert.equal(parseExportTime('12:34:56.789'), 45296789);
	for (const value of [0, 1, 999, 60000, 3600000, 45296789, 360000000]) {
		assert.equal(parseExportTime(formatExportTime(value)), value);
	}
	assert.equal(formatExportTime(59999.6), '00:01:00.000');
});

// 秒・分の繰り上がりや曖昧な小数は入力エラーとして表示する。
test('rejects malformed and out of range timecodes', () => {
	for (const value of ['', '12', '00:60:00.000', '00:00:60.000', '-01:00:00.000', '00:00:00.12', '00:00:00.1234']) {
		assert.ok(Number.isNaN(parseExportTime(value)));
	}
});

// 静止画は倍率の適用と四捨五入だけを行い、奇数サイズも維持する。
test('rounds each scaled dimension exactly once', () => {
	assert.deepEqual(scaleExportResolution({ width: 1001, height: 777 }, 0.5), { width: 501, height: 389 });
	for (const scale of [0.25, 0.5, 1, 2, 4]) {
		assert.deepEqual(scaleExportResolution({ width: 1920, height: 1080 }, scale), { width: Math.round(1920 * scale), height: Math.round(1080 * scale) });
	}
});

// MP4は四捨五入後の奇数の辺だけ増やし、UIとWorkerで繰り返し適用してもサイズが変わらない。
test('adjusts odd video dimensions upward without changing still image dimensions', () => {
	const project = { width: 1001, height: 776 };
	const video = scaleExportResolution(project, 0.5, 'mp4');
	assert.deepEqual(video, { width: 502, height: 388 });
	assert.deepEqual(scaleExportResolution(project, 0.5, 'webp'), { width: 501, height: 388 });
	assert.deepEqual(adjustExportResolution(video, 'mp4'), video);
	assert.deepEqual(adjustExportResolution({ width: 1, height: 8191 }, 'mp4'), { width: 2, height: 8192 });
	assert.deepEqual(adjustExportResolution({ width: 8192, height: 1080 }, 'mp4'), { width: 8192, height: 1080 });
	assert.equal(validateExportSettings({ ...video, format: 'mp4', quality: 'high', fps: 30, startTimeMs: 0, endTimeMs: 1000 }), null);
});

// 不正な入力はサイズ調整で隠さず、通常の検証で拒否する。
test('does not normalize invalid dimensions into valid export sizes', () => {
	for (const width of [0, -1, 1.5, NaN, Infinity, 8193]) {
		const resolution = adjustExportResolution({ width, height: 1080 }, 'mp4');
		assert.equal(typeof validateExportSettings({ ...resolution, format: 'mp4', quality: 'high', fps: 30, startTimeMs: 0, endTimeMs: 1000 }), 'string');
	}
});

// 静止画にFPSや終了時刻は不要で、奇数解像度とロスレスを使用できる。
test('validates still images independently of video-only settings', () => {
	const still = { format: 'webp', quality: 'lossless', width: 501, height: 389, startTimeMs: 12345 };
	assert.equal(validateExportSettings(still), null);
	assert.equal(validateExportSettings({ ...still, fps: NaN, endTimeMs: NaN }), null);
	assert.equal(typeof validateExportSettings({ ...still, startTimeMs: NaN }), 'string');
	assert.equal(typeof validateExportSettings({ ...still, width: 0 }), 'string');
});

// 概算値は倍率・品質・FPS・時間範囲に追従し、静止画には動画の長さを適用しない。
test('estimates file size from dimensions quality and video duration', () => {
	const still = { format: 'webp', quality: 'high', width: 1920, height: 1080, startTimeMs: 0 };
	const video = { ...still, format: 'mp4', fps: 30, endTimeMs: 10000 };
	assert.ok(estimateExportBytes({ ...still, quality: 'lossless' }) > estimateExportBytes(still));
	assert.ok(estimateExportBytes({ ...still, width: 3840, height: 2160 }) > estimateExportBytes(still) * 3);
	assert.equal(estimateExportBytes({ ...still, startTimeMs: 60000 }), estimateExportBytes(still));
	assert.ok(estimateExportBytes({ ...video, fps: 60 }) > estimateExportBytes(video));
	assert.ok(estimateExportBytes({ ...video, endTimeMs: 20000 }) > estimateExportBytes(video));
	assert.ok(estimateExportBytes({ ...video, quality: 'low' }) < estimateExportBytes(video));
});
