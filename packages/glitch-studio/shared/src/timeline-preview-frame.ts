/** プレビューだけの時計とキャッシュ状態。プロジェクトの保存fpsや書き出しには適用しない。 */
export type TimelinePreviewSeekMode = 'frame' | 'precise';
export type TimelinePreviewFrameRange = { startFrame: number; endFrame: number };
export type TimelinePreviewFrameCacheState = {
	sceneId: string | null;
	contentRevision: number;
	previewRevision: number;
	fps: number;
	frameRanges: TimelinePreviewFrameRange[];
	estimatedBytes: number;
	maxBytes: number;
};

export function getTimelinePreviewFrameIndex(timeMs: number, fps: number): number {
	return Math.max(0, Math.round(timeMs * fps / 1000));
}

export function getTimelinePreviewFrameTime(timeMs: number, fps: number): number {
	return getTimelinePreviewFrameIndex(timeMs, fps) * 1000 / fps;
}
