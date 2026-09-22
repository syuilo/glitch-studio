import type { TimelineExportSettings } from './timeline-export.ts';

export function parseExportTime(text: string): number {
	const match = /^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(text.trim());
	if (!match) return NaN;
	const time = ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
	return Number.isSafeInteger(time) ? time : NaN;
}

export function formatExportTime(timeMs: number): string {
	const ms = Math.max(0, Math.round(timeMs));
	const hours = Math.floor(ms / 3600000);
	const minutes = Math.floor(ms / 60000) % 60;
	const seconds = Math.floor(ms / 1000) % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export function adjustExportResolution(resolution: { width: number; height: number }, format: TimelineExportSettings['format']) {
	// H.264用に奇数の辺だけ1px増やす。1pxの入力も2pxになり、偶数の辺は変えない。
	// 不正なサイズを有効な値に隠さず、後続の設定検証に渡す。
	const adjust = (value: number) => format === 'mp4' && Number.isInteger(value) && value > 0
		? Math.ceil(value / 2) * 2
		: value;
	return { width: adjust(resolution.width), height: adjust(resolution.height) };
}

export function scaleExportResolution(resolution: { width: number; height: number }, scale: number, format: TimelineExportSettings['format'] = 'webp') {
	return adjustExportResolution({ width: Math.round(resolution.width * scale), height: Math.round(resolution.height * scale) }, format);
}

/** 平均的な複雑さの画像を想定する目安。実測や上限ではなく、ノイズ・動き・透過で大きく変わる。 */
export function estimateExportBytes(settings: TimelineExportSettings): number {
	const pixels = settings.width * settings.height;
	if (settings.format === 'webp') {
		// 圧縮後の1画素あたりのバイト数。losslessは写真程度の細かさを想定する。
		const bytesPerPixel = { low: 0.08, medium: 0.15, high: 0.3, 'very-high': 0.6, lossless: 1.5 }[settings.quality];
		return Math.round(256 + pixels * bytesPerPixel);
	}
	// H.264の1画素・1フレームあたりの概算ビット数。コンテナの余裕を2%含める。
	const bitsPerPixel = { low: 0.04, medium: 0.08, high: 0.15, 'very-high': 0.3 }[settings.quality];
	const durationSeconds = (settings.endTimeMs - settings.startTimeMs) / 1000;
	return Math.round(4096 + pixels * settings.fps * durationSeconds * bitsPerPixel / 8 * 1.02);
}
