/** 再生要求だけを間引く。シークは進行中の評価を置き換えるため直ちに描画側へ渡す。 */
export class TimelinePreviewScheduler {
	private pendingPlayback: { time: number | null } | null = null;

	constructor(private renderFrame: (time: number) => Promise<boolean>) {}

	clear() { this.pendingPlayback = null; }

	async render(time: number, playback: boolean): Promise<void> {
		if (!playback) {
			this.clear();
			await this.renderFrame(time);
			return;
		}
		if (this.pendingPlayback) {
			this.pendingPlayback.time = time;
			return;
		}
		// 処理中1件と最新の待機位置だけを保持する。毎RAFデコードを中断すると、
		// 1フレームの準備がRAF間隔より遅い環境で、いつまでも映像が表示されない。
		const request = { time: time as number | null };
		this.pendingPlayback = request;
		try {
			while (this.pendingPlayback === request && request.time != null) {
				const nextTime = request.time;
				request.time = null;
				if (!await this.renderFrame(nextTime)) break;
			}
		} finally {
			if (this.pendingPlayback === request) this.pendingPlayback = null;
		}
	}
}
