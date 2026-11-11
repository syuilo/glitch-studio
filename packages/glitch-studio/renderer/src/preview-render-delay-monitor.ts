const RENDER_DELAY_THRESHOLD_MS = 300;
const RENDER_DELAY_CHECK_INTERVAL_MS = 100;

/** プレビューの未完了フレームを監視し、遅延状態の変化だけを通知する。 */
export class PreviewRenderDelayMonitor {
	private readonly frameStartTimes = new Map<object, number>();
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private isDelayed = false;
	private readonly onDelayChanged: (isDelayed: boolean) => void;

	constructor(onDelayChanged: (isDelayed: boolean) => void) {
		this.onDelayChanged = onDelayChanged;
	}

	public beginFrame(frame: object) {
		// 準備待ちを同じフレームで再確認しても、開始時刻を更新しない。
		if (this.frameStartTimes.has(frame)) return;
		this.frameStartTimes.set(frame, performance.now());
		// 完了のたびには解除せず、プレビューの停止まで一つのタイマーを共有する。
		// 高fpsでも毎フレームのタイマー予約・取消を発生させないため。
		this.intervalId ??= setInterval(() => this.checkDelay(), RENDER_DELAY_CHECK_INTERVAL_MS);
	}

	public completeFrame(frame: object) {
		// 中断・対象切替で消したフレームの遅い完了は、現在の状態へ干渉させない。
		if (!this.frameStartTimes.delete(frame)) return;
		if (this.isDelayed) this.checkDelay();
	}

	public clear() {
		this.frameStartTimes.clear();
		this.setDelayed(false);
	}

	public stop() {
		if (this.intervalId != null) clearInterval(this.intervalId);
		this.intervalId = null;
		this.clear();
	}

	private checkDelay() {
		// Mapは開始順を保つ。複数フレームのGPU処理が進行していても、
		// 最も古い未完了フレームだけを確認すれば遅延の有無を判断できる。
		const oldestFrameStartedAt = this.frameStartTimes.values().next().value;
		this.setDelayed(oldestFrameStartedAt != null && performance.now() - oldestFrameStartedAt >= RENDER_DELAY_THRESHOLD_MS);
	}

	private setDelayed(isDelayed: boolean) {
		if (this.isDelayed === isDelayed) return;
		this.isDelayed = isDelayed;
		this.onDelayChanged(isDelayed);
	}
}
