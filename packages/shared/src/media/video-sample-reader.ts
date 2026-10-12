import { VideoSample } from 'mediabunny';
import type { VideoSampleSink } from 'mediabunny';

type ReadingSession = {
	iterator: AsyncIterator<VideoSample>;
	current: VideoSample | null;
	next: VideoSample | null;
	ended: boolean;
	closed: boolean;
};

/** 順方向はデコーダー、逆方向は独立した画素キャッシュを再利用する。返したcloneは呼び出し側が所有する。 */
export class VideoSampleReader {
	private session: ReadingSession | null = null;
	private lastTime: number | null = null;
	private disposed = false;
	private pending: Promise<unknown> = Promise.resolve();
	private reverseSamples: VideoSample[] = [];
	private reverseRange: { start: number; end: number } | null = null;
	private reverseIterator: AsyncIterator<VideoSample> | null = null;
	private generation = 0;

	constructor(private sink: Pick<VideoSampleSink, 'samples'>) {}

	getSample(time: number, reverse = false): Promise<VideoSample | null> {
		const result = this.pending.then(() => this.read(time, reverse));
		this.pending = result.catch(() => {});
		return result;
	}

	private async read(time: number, reverse: boolean): Promise<VideoSample | null> {
		if (this.disposed) throw new Error('Video sample reader is disposed.');
		if (!Number.isFinite(time)) throw new Error('Video time must be finite.');
		if (reverse) return this.readReverse(time);
		if (this.reverseRange) this.reset();
		// 通常再生と1fps以上の書き出しは継続する。大きなジャンプでは途中の全フレームを
		// 読み捨てず、対象近くのキーフレームから再開する。逆方向も新しい読み取りにする。
		if (this.lastTime != null && (time < this.lastTime || time - this.lastTime > 1)) this.reset();
		this.lastTime = time;
		const session = this.session ??= {
			iterator: this.sink.samples(time), current: null, next: null, ended: false, closed: false,
		};
		try {
			// FPSやdurationから次フレームを推測せず、表示順のtimestampで選ぶ。
			// 保持するのは現在と次の2枚だけ。sink内部の先読みも容量制限付きである。
			while (!session.ended && (session.next == null || session.next.timestamp <= time)) {
				if (session.next) {
					session.current?.close();
					session.current = session.next;
					session.next = null;
				}
				const result = await session.iterator.next();
				if (session.closed) {
					if (!result.done) result.value.close();
					throw new Error('Video sample reader was reset or disposed.');
				}
				if (result.done) session.ended = true;
				else session.next = result.value;
			}
			return session.current?.clone() ?? null;
		} catch (error) {
			this.reset();
			throw error;
		}
	}

	private async readReverse(time: number): Promise<VideoSample | null> {
		if (!this.reverseRange || time < this.reverseRange.start || time > this.reverseRange.end) {
			this.reset();
			const generation = this.generation;
			const start = Math.max(0, time - 0.5);
			let bytes = 0;
			const iterator = this.reverseIterator = this.sink.samples(start, time + Number.EPSILON * Math.max(1, time));
			try {
				// デコード自体は表示順で行い、短い窓を逆順に再利用する。全動画やGOP全体を
				// 保持せず、64MiB・90枚を上限とする（単独の巨大フレームは1枚だけ保持）。
				while (true) {
					const result = await iterator.next();
					if (this.disposed || generation !== this.generation) {
						if (!result.done) result.value.close();
						throw new Error('Video sample reader was reset or disposed.');
					}
					if (result.done) break;
					const sample = result.value;
					if (sample.timestamp > time) { sample.close(); break; }
					// デコード済みVideoFrame（cloneも同じ資源を参照する）を蓄積すると、
					// ハードウェアの出力面を使い切り、窓を読み終わる前にデコーダーが停止する。
					// CPUの画素へコピーして元のフレームを即時解放し、保持上限から切り離す。
					let cached: VideoSample;
					try { cached = await copyVideoSample(sample); } finally { sample.close(); }
					if (this.disposed || generation !== this.generation) {
						cached.close();
						throw new Error('Video sample reader was reset or disposed.');
					}
					this.reverseSamples.push(cached);
					bytes += cached.allocationSize();
					while (this.reverseSamples.length > 1 && (bytes > 64 * 1024 * 1024 || this.reverseSamples.length > 90)) {
						const oldest = this.reverseSamples.shift()!;
						bytes -= oldest.allocationSize();
						oldest.close();
					}
				}
				this.reverseRange = { start: Math.max(start, this.reverseSamples[0]?.timestamp ?? start), end: time };
			} catch (error) {
				this.reset();
				throw error;
			} finally {
				this.stopReverseRead();
			}
		}
		return this.reverseSamples.findLast(sample => sample.timestamp <= time)?.clone() ?? null;
	}

	reset() {
		this.generation++;
		for (const sample of this.reverseSamples) sample.close();
		this.reverseSamples = [];
		this.reverseRange = null;
		this.stopReverseRead();
		const session = this.session;
		this.session = null;
		this.lastTime = null;
		if (!session) return;
		session.closed = true;
		session.current?.close();
		session.next?.close();
		session.current = session.next = null;
		// 先読みの停止を通知する。読み取り中のエラーはgetSampleへ伝播し、
		// 破棄の後始末の失敗では元のエラーを上書きしない。
		void session.iterator.return?.().catch(() => {});
	}

	private stopReverseRead() {
		const iterator = this.reverseIterator;
		this.reverseIterator = null;
		void iterator?.return?.().catch(() => {});
	}

	dispose() {
		this.disposed = true;
		this.reset();
	}
}

/** デコーダーとは独立した画素を所有する。clone()ではデコード用の出力面を解放できない。 */
async function copyVideoSample(sample: VideoSample): Promise<VideoSample> {
	// 一部のGPU専用フォーマットではformatがnullになる。明示的なRGBA/sRGB変換でコピーする。
	const options: VideoFrameCopyToOptions = sample.format == null ? { format: 'RGBA', colorSpace: 'srgb' } : {};
	const data = new Uint8Array(sample.allocationSize(options));
	const layout = await sample.copyTo(data, options);
	return new VideoSample(data, {
		format: sample.format ?? 'RGBA', layout,
		// copyToの既定範囲はvisibleRect。コピー済み画素へ元の切り抜き位置を二重に適用しない。
		codedWidth: sample.codedWidth, codedHeight: sample.codedHeight,
		displayWidth: sample.displayWidth, displayHeight: sample.displayHeight, rotation: sample.rotation,
		timestamp: sample.timestamp, duration: sample.duration,
		...(sample.format == null ? {} : { colorSpace: sample.colorSpace }),
	});
}
