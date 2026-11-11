import { getTimelineClipLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { OpenExrCompression } from '@gs/subsystems_image-codec/openexr-encoder.ts';
export type ExportQuality = 'low' | 'medium' | 'high' | 'very-high';

type ExportImageSettings = {
	width: number;
	height: number;
	positionMs: number;
};

export type VideoExportSettings = ExportImageSettings & {
	format: 'mp4';
	quality: ExportQuality;
	fps: number;
	endTimeMs: number;
};

export type WebpStillExportSettings = ExportImageSettings & {
	format: 'webp';
	quality: ExportQuality | 'lossless';
};

export type OpenExrStillExportSettings = ExportImageSettings & {
	format: 'exr';
	compression: OpenExrCompression;
};

export type StillExportSettings = WebpStillExportSettings | OpenExrStillExportSettings;

export type TimelineExportSettings = VideoExportSettings | StillExportSettings;

type FrameExportProgress = {
	phase: 'preparing' | 'rendering' | 'finalizing';
	completedFrames: number;
	totalFrames: number;
};

export type ExportProgress = FrameExportProgress | { phase: 'encoding-exr'; completedBlocks: number; totalBlocks: number }
	| { phase: 'saving'; completedBytes: number; totalBytes: number | null };

export function getExportProgressFraction(progress: ExportProgress): number | null {
	const fraction = progress.phase === 'encoding-exr' ? progress.completedBlocks / progress.totalBlocks
		: progress.phase === 'saving' ? progress.totalBytes == null ? null : progress.completedBytes / progress.totalBytes
			: progress.phase === 'rendering' && progress.totalFrames > 0 ? progress.completedFrames / progress.totalFrames : null;
	return fraction == null || !Number.isFinite(fraction) ? null : Math.max(0, Math.min(1, fraction));
}

export function getTimelineEnd(timeline: readonly TimelineLayer[]): number {
	return getTimelineClipLayers(timeline).reduce((end, entry) => entry.clips.reduce((end, clip) => Math.max(end, getTimelineClipEnd(clip)), end), 0);
}

/** 保存形式の上限とGPU上限を、入力欄と設定検証で共通に扱う。 */
export function getExportMaxDimension(format: TimelineExportSettings['format'], maxTextureDimension2D = Number.MAX_SAFE_INTEGER): number {
	// WebPはlibwebpの上限。EXRの描画寸法はGPU側の上限で制限する。
	return Math.min(maxTextureDimension2D, format === 'mp4' ? 8192 : format === 'webp' ? 16383 : Number.MAX_SAFE_INTEGER);
}

export function validateExportSettings(settings: TimelineExportSettings, maxTextureDimension2D = Number.MAX_SAFE_INTEGER): string | null {
	if (settings.format !== 'mp4' && settings.format !== 'webp' && settings.format !== 'exr') return 'Unsupported export format.';
	if (settings.format === 'exr') {
		if (settings.compression !== 'none' && settings.compression !== 'zip') return 'Invalid OpenEXR compression setting.';
	} else if (!['low', 'medium', 'high', 'very-high', ...(settings.format === 'webp' ? ['lossless'] : [])].includes(settings.quality)) return 'Invalid quality setting.';
	if (![settings.width, settings.height].every(value => Number.isSafeInteger(value) && value >= 1)) return 'Output width and height must be positive integers.';
	const maxDimension = getExportMaxDimension(settings.format);
	if (settings.width > maxDimension || settings.height > maxDimension) {
		return `Output width and height must be integers between 1 and ${maxDimension}.`;
	}
	if (settings.width > maxTextureDimension2D || settings.height > maxTextureDimension2D) return `Output resolution exceeds this GPU's texture size limit (${maxTextureDimension2D} px per side).`;
	if (!Number.isSafeInteger(settings.positionMs) || settings.positionMs < 0) return 'Enter a valid start time (HH:MM:SS.mmm).';
	if (settings.format !== 'mp4') return null;
	if (settings.width % 2 !== 0 || settings.height % 2 !== 0) return 'MP4 requires even dimensions. Choose another resolution scale or change the scene resolution.';
	if (!Number.isFinite(settings.fps) || settings.fps < 1 || settings.fps > 120) return 'Frame rate must be between 1 and 120 fps.';
	if (!Number.isFinite(settings.positionMs) || !Number.isFinite(settings.endTimeMs)
		|| settings.positionMs < 0 || settings.endTimeMs <= settings.positionMs) {
		return 'End time must be greater than start time, and start time must be non-negative.';
	}
	if (!Number.isSafeInteger(Math.ceil((settings.endTimeMs - settings.positionMs) * settings.fps / 1000))) return 'Export range is too long.';
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
// Canvasの取り込みを終えてから同じ時刻まで音声を供給し、両トラックを揃えて確定する。
export async function renderExportFrames(settings: VideoExportSettings, callbacks: {
	render: (frame: ExportFrame) => Promise<void>;
	addFrame: (frame: ExportFrame) => Promise<void>;
	addAudioUntil?: ((timeSeconds: number) => Promise<void>) | null;
	finalize: () => Promise<void>;
	onProgress: (progress: FrameExportProgress) => void;
	signal: AbortSignal;
}): Promise<void> {
	const error = validateExportSettings(settings);
	if (error) throw new Error(error);
	const duration = (settings.endTimeMs - settings.positionMs) / 1000;
	const totalFrames = Math.ceil(duration * settings.fps);
	for (let index = 0; index < totalFrames; index++) {
		callbacks.signal.throwIfAborted();
		// 加算を繰り返さず、フレーム番号から毎回計算して時刻の誤差蓄積を避ける。
		const timestamp = index / settings.fps;
		const frame: ExportFrame = {
			timeMs: settings.positionMs + timestamp * 1000,
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
		// 片方だけを先に全編生成するとmuxerの待機データが増えるため、時間順に供給する。
		await callbacks.addAudioUntil?.(Math.min((index + 1) / settings.fps, duration));
		callbacks.signal.throwIfAborted();
		callbacks.onProgress({ phase: 'rendering', completedFrames: index + 1, totalFrames });
	}
	callbacks.onProgress({ phase: 'finalizing', completedFrames: totalFrames, totalFrames });
	callbacks.signal.throwIfAborted();
	await callbacks.finalize();
	callbacks.signal.throwIfAborted();
}
