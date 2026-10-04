/** 再生・シークとも、処理中の1件と最新の待機位置だけを保持する。 */
export class TimelinePreviewScheduler {
	private pendingTime: number | null = null;
	private rendering = false;
	private generation = 0;

	// コールバックは準備・描画だけでなく、送信済みGPU処理の完了まで待つこと。
	constructor(private renderFrame: (time: number) => Promise<boolean>) {}

	clear() {
		this.pendingTime = null;
		this.generation++;
		// 編集・Scene切り替えで要求を破棄しても、送信済みGPU処理は取り消せない。
		// renderingは維持し、新しい状態のフレームも進行中の処理が終わってから開始する。
	}

	/** 描画中の呼び出しは待機位置の更新だけで戻り、最初の呼び出しが完了まで待つ。 */
	async render(time: number): Promise<void> {
		this.pendingTime = time;
		if (this.rendering) return;
		// シークごとに準備を中断すると、重いフレームはいつまでも表示できない。
		// 進行中のフレームを完成させてから、その間に届いた最新位置へ追従する。
		this.rendering = true;
		try {
			while (this.pendingTime != null) {
				const nextTime = this.pendingTime;
				const generation = this.generation;
				this.pendingTime = null;
				const succeeded = await this.renderFrame(nextTime);
				// 失敗後の自動継続は止める。ただし編集前の失敗によって、clear後に
				// 届いた修正済みの描画要求まで捨ててはいけない。
				if (!succeeded && generation === this.generation) break;
			}
		} finally {
			this.pendingTime = null;
			this.rendering = false;
		}
	}
}
