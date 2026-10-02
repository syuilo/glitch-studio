import type { EffectStatus } from '../../effect-status.ts';

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

export type VideoFrameSource<Sample> = {
	getSample: (position: number) => Promise<Sample | null>;
	dispose: () => void;
};

// デコードとGPUアップロードを境界に分け、要求の競合・破棄をブラウザーなしでテストできるようにする。
export function createVideoFrameLoader<Sample extends { close: () => void }>(options: {
	open: (blob: Blob) => VideoFrameSource<Sample>;
	publish: (sample: Sample | null) => void;
	reportStatus: (status: EffectStatus) => void;
}) {
	let desired: { blob: Blob | null; time: number | null } | undefined;
	let revision = 0;
	let disposed = false;
	let running = false;
	let source: VideoFrameSource<Sample> | undefined;
	let sourceBlob: Blob | undefined;

	const releaseSource = () => {
		source?.dispose();
		source = undefined;
		sourceBlob = undefined;
	};

	const drain = async () => {
		running = true;
		try {
			while (!disposed && desired?.blob != null && desired.time != null) {
				const request = { blob: desired.blob, time: desired.time };
				const requestRevision = revision;
				let sample: Sample | null = null;
				try {
					if (sourceBlob !== request.blob || source == null) {
						releaseSource();
						source = options.open(request.blob);
						sourceBlob = request.blob;
					}
					sample = await source.getSample(request.time);
					if (!disposed && requestRevision === revision) {
						// publishは同期的にGPUへコピーする。保持せず、finallyで必ずcloseする。
						options.publish(sample);
						options.reportStatus({ type: 'ready' });
					}
				} catch (error) {
					if (!disposed && requestRevision === revision) {
						releaseSource();
						options.publish(null);
						options.reportStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) });
					}
				} finally {
					sample?.close();
				}
				if (requestRevision === revision) break;
				// 待機中に何回timeが変わっても、最新の1件だけを処理する。
			}
		} finally {
			running = false;
		}
	};

	return {
		prepare(blob: Blob | null, time: number, mode: OutOfRange) {
			if (disposed) return;
			let position: number | null;
			try {
				position = normalizeVideoTime(time, mode);
			} catch (error) {
				++revision;
				desired = undefined;
				releaseSource();
				options.publish(null);
				options.reportStatus({ type: 'error', message: (error as Error).message });
				return;
			}
			if (desired?.blob === blob && desired.time === position) return;
			desired = { blob, time: position };
			++revision;
			if (sourceBlob !== blob) releaseSource();
			// ライブ描画でも異なる時刻のフレームを正しい結果として表示しない。
			options.publish(null);
			if (blob == null || position == null) {
				options.reportStatus({ type: 'ready' });
				return;
			}
			options.reportStatus({ type: 'loading' });
			if (!running) void drain();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			++revision;
			desired = undefined;
			releaseSource();
		},
	};
}
