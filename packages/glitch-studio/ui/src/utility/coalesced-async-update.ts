/** 非同期更新を直列化し、待機中の変更は最新状態への一回の更新にまとめる。 */
export class CoalescedAsyncUpdate {
	private timer: number | null = null;
	private pending = false;
	private running = false;
	private flushRequested = false;
	private generation = 0;

	constructor(private readonly apply: () => Promise<void>, private readonly onError: (error: unknown) => void) {}

	public request() {
		this.pending = true;
		this.schedule();
	}

	private schedule() {
		if (!this.pending || this.running || this.timer != null) return;
		this.timer = globalThis.setTimeout(() => { this.timer = null; void this.run(); }, 100);
	}

	public flush() {
		if (this.timer != null) globalThis.clearTimeout(this.timer);
		this.timer = null;
		if (this.running) { this.flushRequested = true; return; }
		void this.run();
	}

	private async run() {
		if (this.running || !this.pending) return;
		this.pending = false;
		this.running = true;
		const generation = this.generation;
		try {
			await this.apply();
		} catch (error) {
			if (generation === this.generation) this.onError(error);
		} finally {
			this.running = false;
			const flush = this.flushRequested;
			this.flushRequested = false;
			if (flush) {
				this.flush();
			} else {
				this.schedule();
			}
		}
	}

	public clear() {
		this.generation++;
		if (this.timer != null) globalThis.clearTimeout(this.timer);
		this.timer = null;
		this.pending = false;
		this.flushRequested = false;
		// 開始済みのGPU処理は完了を待つ。次の要求を並行実行して待ち行列を増やさない。
	}
}
