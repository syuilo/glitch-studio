export type OutOfRange = 'clamp' | 'loop' | 'transparent';

export function normalizeVideoTime(time: number, mode: OutOfRange): number | null {
	if (!Number.isFinite(time)) throw new Error('Video time must be finite.');
	if (mode === 'transparent' && (time < 0 || time > 1)) return null;
	if (mode === 'loop') return time - Math.floor(time);
	return Math.min(1, Math.max(0, time));
}

export function videoTimestamp(position: number, firstTimestamp: number, endTimestamp: number): number {
	// 1は「最終フレームの開始時刻」ではなく表示区間の末尾。途中の時間配分を縮めない。
	// 末尾だけInfinityで明示的に最終フレームを取得し、丸め誤差にも依存しない。
	if (position === 1) return Infinity;
	return firstTimestamp + (endTimestamp - firstTimestamp) * position;
}
