/** 通常のフレーム描画が途切れた間だけ、表示中プレビューの背景を30fpsで更新する。 */
export class PreviewBackgroundScheduler {
	private enabled = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private renderPending = false;
	private generation = 0;

	constructor(private readonly renderBackground: () => Promise<void>) {}

	public setEnabled(enabled: boolean) {
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		this.generation++;
		this.cancelTimer();
		this.schedule();
	}

	public notifyFrameRendered() {
		// 通常描画にも現在位相の背景が含まれる。次の背景更新をそこから数え直すことで、
		// 再生中のフレームと独立タイマーが同じ最終画像を重複して描くことを防ぐ。
		this.cancelTimer();
		this.schedule();
	}

	private cancelTimer() {
		if (this.timer != null) clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule() {
		if (!this.enabled || this.renderPending || this.timer != null) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.render();
		}, 1000 / 30);
	}

	private async render() {
		const generation = this.generation;
		this.renderPending = true;
		try {
			await this.renderBackground();
		} catch {
			if (generation === this.generation) this.setEnabled(false);
		} finally {
			this.renderPending = false;
			// 無効化・再有効化の間に旧描画が完了した場合も、現在の表示状態から再開する。
			this.schedule();
		}
	}
}
