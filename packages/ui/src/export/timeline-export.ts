export type TimelineExportSettings = {
	format: 'mp4';
	quality: 'low' | 'medium' | 'high' | 'very-high';
	width: number;
	height: number;
	fps: number;
	startTimeMs: number;
	endTimeMs: number;
};

export type ExportProgress = {
	phase: 'preparing' | 'rendering' | 'finalizing';
	completedFrames: number;
	totalFrames: number;
};

export function getTimelineEnd(timeline: readonly { endTimeMs: number }[]): number {
	return timeline.reduce((end, entry) => Math.max(end, entry.endTimeMs), 0);
}

export function validateExportSettings(settings: TimelineExportSettings): string | null {
	if (settings.format !== 'mp4') return 'Unsupported export format.';
	if (!['low', 'medium', 'high', 'very-high'].includes(settings.quality)) return 'Invalid quality setting.';
	if (![settings.width, settings.height].every(value => Number.isInteger(value) && value >= 2 && value <= 8192 && value % 2 === 0)) {
		return 'MP4 width and height must be even integers between 2 and 8192.';
	}
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
export async function renderExportFrames(settings: TimelineExportSettings, callbacks: {
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
