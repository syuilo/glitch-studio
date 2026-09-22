export type ExportQuality = 'low' | 'medium' | 'high' | 'very-high';

type ExportImageSettings = {
	width: number;
	height: number;
	startTimeMs: number;
};

export type VideoExportSettings = ExportImageSettings & {
	format: 'mp4';
	quality: ExportQuality;
	fps: number;
	endTimeMs: number;
};

export type StillExportSettings = ExportImageSettings & {
	format: 'webp';
	quality: ExportQuality | 'lossless';
};

export type TimelineExportSettings = VideoExportSettings | StillExportSettings;

export type ExportProgress = {
	phase: 'preparing' | 'rendering' | 'finalizing';
	completedFrames: number;
	totalFrames: number;
};

export function getTimelineEnd(timeline: readonly { endTimeMs: number }[]): number {
	return timeline.reduce((end, entry) => Math.max(end, entry.endTimeMs), 0);
}

export function validateExportSettings(settings: TimelineExportSettings): string | null {
	if (settings.format !== 'mp4' && settings.format !== 'webp') return 'Unsupported export format.';
	if (!['low', 'medium', 'high', 'very-high', ...(settings.format === 'webp' ? ['lossless'] : [])].includes(settings.quality)) return 'Invalid quality setting.';
	if (![settings.width, settings.height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192)) {
		return 'Output width and height must be integers between 1 and 8192.';
	}
	if (!Number.isSafeInteger(settings.startTimeMs) || settings.startTimeMs < 0) return 'Enter a valid start time (HH:MM:SS.mmm).';
	if (settings.format === 'webp') return null;
	if (settings.width % 2 !== 0 || settings.height % 2 !== 0) return 'MP4 requires even dimensions. Choose another resolution scale or change the project resolution.';
	if (!Number.isFinite(settings.fps) || settings.fps < 1 || settings.fps > 120) return 'Frame rate must be between 1 and 120 fps.';
	if (!Number.isFinite(settings.startTimeMs) || !Number.isFinite(settings.endTimeMs)
		|| settings.startTimeMs < 0 || settings.endTimeMs <= settings.startTimeMs) {
		return 'End time must be greater than start time, and start time must be non-negative.';
	}
	if (!Number.isSafeInteger(Math.ceil((settings.endTimeMs - settings.startTimeMs) * settings.fps / 1000))) return 'Export range is too long.';
	return null;
}

export type ExportFrame = {
	timeMs: number;
	timeDeltaMs: number;
	/** ファイル上の時刻は、範囲指定の開始時刻によらず0秒から始める。 */
	timestamp: number;
	duration: number;
};

// GPUやコンテナ形式から独立させ、時刻計算と非同期処理の順序をテストできるようにする。
// 将来の音声トラックは形式別のwriterに追加でき、ここでは動画フレームの供給だけを担う。
export async function renderExportFrames(settings: VideoExportSettings, callbacks: {
	render: (frame: ExportFrame) => Promise<void>;
	addFrame: (frame: ExportFrame) => Promise<void>;
	finalize: () => Promise<void>;
	onProgress: (progress: ExportProgress) => void;
	signal: AbortSignal;
}): Promise<void> {
	const error = validateExportSettings(settings);
	if (error) throw new Error(error);
	const duration = (settings.endTimeMs - settings.startTimeMs) / 1000;
	const totalFrames = Math.ceil(duration * settings.fps);
	for (let index = 0; index < totalFrames; index++) {
		callbacks.signal.throwIfAborted();
		// 加算を繰り返さず、フレーム番号から毎回計算して時刻の誤差蓄積を避ける。
		const timestamp = index / settings.fps;
		const frame: ExportFrame = {
			timeMs: settings.startTimeMs + timestamp * 1000,
			timeDeltaMs: index === 0 ? 0 : 1000 / settings.fps,
			timestamp,
			duration: Math.min((index + 1) / settings.fps, duration) - timestamp,
		};
		await callbacks.render(frame);
		callbacks.signal.throwIfAborted();
		// addFrameがCanvasを取り込むまで、タイマー等で別タスクへ制御を渡さない。
		// WebGPUのCanvasはタスク境界で表示・破棄される可能性がある。
		await callbacks.addFrame(frame);
		callbacks.signal.throwIfAborted();
		callbacks.onProgress({ phase: 'rendering', completedFrames: index + 1, totalFrames });
	}
	callbacks.onProgress({ phase: 'finalizing', completedFrames: totalFrames, totalFrames });
	callbacks.signal.throwIfAborted();
	await callbacks.finalize();
	callbacks.signal.throwIfAborted();
}
