import type { VideoSample, VideoSampleSink } from 'mediabunny';

type ReadingSession = {
	iterator: AsyncIterator<VideoSample>;
	current: VideoSample | null;
	next: VideoSample | null;
	ended: boolean;
	closed: boolean;
};

/** 順方向の読み取りでデコーダーを維持する。返したcloneの所有権は呼び出し側へ渡す。 */
export class VideoSampleReader {
	private session: ReadingSession | null = null;
	private lastTime: number | null = null;
	private disposed = false;
	private pending: Promise<unknown> = Promise.resolve();

	constructor(private sink: Pick<VideoSampleSink, 'samples'>) {}

	getSample(time: number): Promise<VideoSample | null> {
		const result = this.pending.then(() => this.read(time));
		this.pending = result.catch(() => {});
		return result;
	}

	private async read(time: number): Promise<VideoSample | null> {
		if (this.disposed) throw new Error('Video sample reader is disposed.');
		if (!Number.isFinite(time)) throw new Error('Video time must be finite.');
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

	reset() {
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

	dispose() {
		this.disposed = true;
		this.reset();
	}
}
