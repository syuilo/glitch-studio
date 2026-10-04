/**
 * 1出力フレームを構成する複数回の評価をまとめて中断する。
 * 出力は次の評価で上書きされ得るため、受け取るたびに同期的に蓄積・submitする。
 * GPUの所有・Canvasへの表示は呼び出し側が担当する。
 */
export class TimelineFrameRenderer<Output> {
	private controller: AbortController | null = null;
	private previousSampleTime: number | null = null;

	constructor(private callbacks: {
		evaluate: (time: number, timeDelta: number, isExport: boolean, signal: AbortSignal) => Promise<{ output: Output; gpuTime: number } | undefined>;
		accumulate: (output: Output, index: number) => Output;
		present: (output: Output, gpuTime: number) => void;
	}) {}

	cancel() {
		this.controller?.abort();
		this.controller = null;
	}

	clear() {
		this.cancel();
		this.previousSampleTime = null;
	}

	async render(times: readonly number[], isExport: boolean, initialTimeDelta = 0): Promise<void> {
		this.cancel();
		const controller = new AbortController();
		this.controller = controller;
		let output: Output | undefined;
		let gpuTime = 0;
		try {
			for (let index = 0; index < times.length; index++) {
				const time = times[index];
				// 通常の1回描画では、既存の呼び出し側が指定した時間差を維持する。
				const delta = times.length === 1 || this.previousSampleTime == null ? initialTimeDelta : time - this.previousSampleTime;
				const result = await this.callbacks.evaluate(time, delta, isExport, controller.signal);
				if (controller.signal.aborted || result == null) return;
				// 履歴依存エフェクトは動作保証対象外。時刻の巻き戻りによる特別なリセットはしない。
				this.previousSampleTime = time;
				output = times.length === 1 ? result.output : this.callbacks.accumulate(result.output, index);
				gpuTime += result.gpuTime;
			}
			if (output !== undefined) this.callbacks.present(output, gpuTime);
		} catch (error) {
			if (!controller.signal.aborted) throw error;
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}
}
