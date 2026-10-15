/** 再生・シークとも、処理中の1件と最新の待機位置だけを保持する。 */
export class TimelinePreviewScheduler {
	private pendingTime: number | null = null;
	private rendering = false;
	private generation = 0;
	private previousTime: number | null = null;

	// コールバックは準備・描画だけでなく、送信済みGPU処理の完了まで待つこと。
	constructor(private renderFrame: (time: number, timeDelta: number) => Promise<boolean>) {}

	clear(preservePendingTime = false) {
		if (!preservePendingTime) this.pendingTime = null;
		this.generation++;
		this.previousTime = null;
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
				// 要求が間引かれた分も含め、実際に描画した時刻の差を渡す。
				// 同時刻の再描画は0、逆方向のシークは負の値とし、履歴の扱いは各エフェクトに委ねる。
				const timeDelta = this.previousTime == null ? 0 : nextTime - this.previousTime;
				const succeeded = await this.renderFrame(nextTime, timeDelta);
				// clear後に完了した旧世代の処理で、新しいSceneなどの基準時刻を上書きしない。
				if (succeeded && generation === this.generation) this.previousTime = nextTime;
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
