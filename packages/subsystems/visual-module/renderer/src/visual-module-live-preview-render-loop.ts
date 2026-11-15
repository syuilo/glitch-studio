export type FrameScheduler = {
	// nowとコールバックのtimestampは同じ時刻基準（ミリ秒）を使う。
	now: () => number;
	requestFrame: (callback: (timestamp: number) => void) => number;
	cancelFrame: (id: number) => void;
};

export const browserFrameScheduler: FrameScheduler = {
	now: () => performance.now(),
	requestFrame: callback => requestAnimationFrame(callback),
	cancelFrame: id => cancelAnimationFrame(id),
};

export type VisualModuleLivePreviewFrameTiming = {
	time: number;
	timeDelta: number;
	realTimeDelta: number;
};

export class VisualModuleLivePreviewRenderLoop {
	public fpsLimit: number | null;
	public timeFactor: number;
	private scheduler: FrameScheduler;
	private onFrame: (timing: VisualModuleLivePreviewFrameTiming) => void | Promise<void>;
	private onSkippedFrame: ((timing: VisualModuleLivePreviewFrameTiming) => void) | null;
	private frameInFlight: Promise<void> | null = null;
	private frameId: number | null = null;
	private running = false;
	private generation = 0;
	private latestTimestamp = 0;
	private nextFrameTimestamp: number | null = null;
	private previousFpsLimit: number | null = null;
	private time = 0;

	constructor(options: {
		scheduler: FrameScheduler;
		onFrame: (timing: VisualModuleLivePreviewFrameTiming) => void | Promise<void>;
		onSkippedFrame?: (timing: VisualModuleLivePreviewFrameTiming) => void;
		fpsLimit: number | null;
		timeFactor: number;
	}) {
		this.scheduler = options.scheduler;
		this.onFrame = options.onFrame;
		this.onSkippedFrame = options.onSkippedFrame ?? null;
		this.fpsLimit = options.fpsLimit;
		this.timeFactor = options.timeFactor;
	}

	public start() {
		this.stop();
		this.running = true;
		this.latestTimestamp = this.scheduler.now();
		this.nextFrameTimestamp = null;
		this.previousFpsLimit = null;
		this.scheduleFrame(this.generation);
	}

	public stop() {
		this.running = false;
		this.generation++;
		if (this.frameId != null) this.scheduler.cancelFrame(this.frameId);
		this.frameId = null;
	}

	private scheduleFrame(generation: number) {
		this.frameId = this.scheduler.requestFrame(timestamp => {
			// キャンセル済みのコールバックが届いても、再開後のループに干渉させない。
			if (!this.running || generation !== this.generation) return;
			this.frameId = null;
			// 描画中のstopで次回予約を解除でき、描画が例外になっても従来どおり継続する。
			this.scheduleFrame(generation);
			this.renderFrame(timestamp);
		});
	}

	private takeScheduledFrame(timestamp: number): boolean {
		// 制限なしではすべてのコールバックを通し、再有効化時に古い描画予定を持ち越さない。
		if (this.fpsLimit == null) {
			this.nextFrameTimestamp = null;
			this.previousFpsLimit = null;
			return true;
		}
		const interval = 1000 / this.fpsLimit;
		if (this.nextFrameTimestamp == null || this.previousFpsLimit !== this.fpsLimit) {
			// 初回と設定変更後は直ちに描画し、そのコールバックを新しい周期の起点にする。
			this.previousFpsLimit = this.fpsLimit;
			this.nextFrameTimestamp = timestamp + interval;
			return true;
		}

		// 60HzでもrAFの時刻は丸めによって16.6ms / 16.7ms間隔になる。
		// 境界よりわずかに早いだけで一周期分の描画機会を失わないよう、小さな揺れを許容する。
		const tolerance = Math.min(0.5, interval / 2);
		if (timestamp + tolerance < this.nextFrameTimestamp) return false;

		// 実際の描画時刻に置き直さず、予定時刻から進めて表示周期との端数を持ち越す。
		// 長い待機で過ぎた枠は追い掛けず、次の予定だけを残して入力遅延と負荷の増加を防ぐ。
		const elapsedIntervals = Math.floor((timestamp + tolerance - this.nextFrameTimestamp) / interval) + 1;
		this.nextFrameTimestamp += elapsedIntervals * interval;
		return true;
	}

	// 1フレームだけ進める。次回の予約は行わないため、テストでも任意の時刻を渡せる。
	public renderFrame(timestamp: number) {
		if (!this.running || !this.takeScheduledFrame(timestamp)) return;

		const realTimeDelta = timestamp - this.latestTimestamp;
		const timeDelta = realTimeDelta * this.timeFactor;
		this.time += timeDelta;
		// スキップしたフレームの時間も含め、出力の有無によらず描画前に時刻を更新する。
		this.latestTimestamp = timestamp;
		const timing = { time: this.time, timeDelta, realTimeDelta };
		if (this.frameInFlight != null) {
			this.onSkippedFrame?.(timing);
			return;
		}
		const result = this.onFrame(timing);
		if (result != null && typeof result.then === 'function') {
			this.frameInFlight = result;
			// stop/startの世代をまたいでも、旧描画と新描画を重ねない。
			// エラーの通知はonFrameを提供する所有者が担当する。
			const settled = () => { if (this.frameInFlight === result) this.frameInFlight = null; };
			void result.then(settled, settled);
		}
	}
}
