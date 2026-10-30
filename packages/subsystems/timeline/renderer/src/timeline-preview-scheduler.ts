type SubmittedPreviewFrame = {
	generation: number;
	completed: Promise<boolean>;
	outcome: { type: 'pending' } | { type: 'completed'; succeeded: boolean } | { type: 'failed'; error: unknown };
};

/** CPUの準備は直列に行い、送信済みのフレーム数を制限しながら未着手の要求は最新1件だけを保持する。 */
export class TimelinePreviewScheduler {
	private pendingTime: number | null = null;
	private rendering = false;
	private generation = 0;
	private previousTime: number | null = null;
	private pendingRequest = Promise.withResolvers<void>();

	// onSubmittedはCPU側の評価・送信が成功した時だけ呼ぶ。戻り値は引き続きGPU完了を表し、
	// 通知を省略する呼び出し側は従来どおり完了まで直列になる。GPUの完了通知が遅くても
	// 次の準備を進められる一方、重いフレームを際限なく積み上げないため送信数を制限する。
	constructor(
		private renderFrame: (time: number, timeDelta: number, onSubmitted: () => void) => Promise<boolean>,
		private readonly maxSubmittedFrames = 2,
	) {
		if (!Number.isSafeInteger(maxSubmittedFrames) || maxSubmittedFrames < 1) throw new RangeError('Invalid submitted preview frame limit');
	}

	clear() {
		this.pendingTime = null;
		this.generation++;
		this.previousTime = null;
		// 編集・Scene切り替えで要求を破棄しても、送信済みGPU処理は取り消せない。
		// renderingは維持し、新しい状態のフレームも進行中の処理が終わってから開始する。
	}

	/** 描画中の呼び出しは待機位置の更新だけで戻り、最初の呼び出しは送信済みの全フレームの完了まで待つ。 */
	async render(time: number): Promise<void> {
		this.pendingTime = time;
		this.pendingRequest.resolve();
		if (this.rendering) return;
		// シークごとに準備を中断すると、重いフレームはいつまでも表示できない。
		// 進行中のフレームを完成させてから、その間に届いた最新位置へ追従する。
		this.rendering = true;
		const submittedFrames: SubmittedPreviewFrame[] = [];
		let failedGeneration: number | null = null;
		try {
			while (this.pendingTime != null || submittedFrames.length > 0) {
				// GPUの送信順と、キャッシュ用エラースコープ確認まで含めた完了順は一致しない。
				// 先頭の後処理が遅くても後続の完了分を回収し、空いた枠で次の準備を始める。
				for (let index = submittedFrames.length - 1; index >= 0; index--) {
					const frame = submittedFrames[index];
					if (frame.outcome.type === 'pending') continue;
					submittedFrames.splice(index, 1);
					if (frame.outcome.type === 'failed') throw frame.outcome.error;
					// 編集前の失敗で、編集後に届いた要求まで捨てない。
					if (frame.outcome.type === 'completed' && !frame.outcome.succeeded && frame.generation === this.generation) {
						this.pendingTime = null;
						failedGeneration = this.generation;
					}
				}
				const mustDrain = submittedFrames.some(frame => frame.generation !== this.generation)
					|| (failedGeneration === this.generation && submittedFrames.length > 0);
				if (this.pendingTime != null && submittedFrames.length < this.maxSubmittedFrames && !mustDrain) {
					const nextTime = this.pendingTime;
					const generation = this.generation;
					this.pendingTime = null;
					// 経過時間はGPU通知の順番ではなく、直列に評価・送信したScene時刻で計算する。
					const timeDelta = this.previousTime == null ? 0 : nextTime - this.previousTime;
					const submitted = Promise.withResolvers<boolean>();
					const completed = this.renderFrame(nextTime, timeDelta, () => submitted.resolve(true));
					const frame: SubmittedPreviewFrame = { generation, completed, outcome: { type: 'pending' } };
					submittedFrames.push(frame);
					void completed.then(succeeded => {
						frame.outcome = { type: 'completed', succeeded };
						submitted.resolve(succeeded);
					}, error => {
						frame.outcome = { type: 'failed', error };
						submitted.reject(error);
					});
					if (await submitted.promise && generation === this.generation) this.previousTime = nextTime;
					continue;
				}
				if (submittedFrames.length === 0) break;
				const completions = submittedFrames.map(frame => frame.completed);
				if (submittedFrames.length >= this.maxSubmittedFrames || mustDrain) {
					// 編集や失敗後の再試行は、空き枠があっても送信済みGPU処理を追い越さない。
					await Promise.race(completions);
				} else {
					// 空き枠がある時は次の要求でも起こす。GPU完了だけを待つと再び完全な直列になる。
					this.pendingRequest = Promise.withResolvers<void>();
					await Promise.race([...completions, this.pendingRequest.promise]);
				}
			}
		} finally {
			// 準備やGPU待機がrejectしても、既に送った他のフレームを残して次の描画へ進まない。
			if (submittedFrames.length > 0) await Promise.allSettled(submittedFrames.map(frame => frame.completed));
			this.pendingTime = null;
			this.rendering = false;
		}
	}
}
