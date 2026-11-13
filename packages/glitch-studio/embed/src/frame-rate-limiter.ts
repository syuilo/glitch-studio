/** rAFの時刻で描画の可否を決める。作品の時計とWorkerの処理中状態は呼び出し側が所有する。 */
export class PortableVisualModuleFrameRateLimiter {
	private nextFrameTimestamp: number | null = null;
	private previousFpsLimit: number | null = null;

	public reset() {
		this.nextFrameTimestamp = null;
		this.previousFpsLimit = null;
	}

	public takeFrame(timestamp: number, fpsLimit: number | null): boolean {
		// 自動ではrAFの呼び出しをそのまま通す。数値指定へ戻った際に古い予定時刻を使わない。
		if (fpsLimit == null) { this.reset(); return true; }
		const interval = 1000 / fpsLimit;
		if (this.nextFrameTimestamp == null || this.previousFpsLimit !== fpsLimit) {
			this.previousFpsLimit = fpsLimit;
			this.nextFrameTimestamp = timestamp + interval;
			return true;
		}

		// 60HzのrAFでも時刻の丸めで16.6ms / 16.7msとなる。厳密な16.666…ms判定では
		// 早く届いたコールバックを丸ごと捨ててしまうため、境界の小さな揺れを許容する。
		const tolerance = Math.min(0.5, interval / 2);
		if (timestamp + tolerance < this.nextFrameTimestamp) return false;

		// 実際に描いた時刻へ基準を置き直すと、表示周期との端数が毎回失われる。
		// 予定時刻の位相を保って進め、GPU待ちなどで過ぎた枠は追い掛けずに捨てる。
		const elapsedIntervals = Math.floor((timestamp + tolerance - this.nextFrameTimestamp) / interval) + 1;
		this.nextFrameTimestamp += elapsedIntervals * interval;
		return true;
	}
}
