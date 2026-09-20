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

export type LiveFrameTiming = {
	time: number;
	timeDelta: number;
	realTimeDelta: number;
};

export class LiveRenderLoop {
	public fpsLimit: number | null;
	public timeFactor: number;
	private scheduler: FrameScheduler;
	private onFrame: (timing: LiveFrameTiming) => void;
	private frameId: number | null = null;
	private running = false;
	private generation = 0;
	private latestTimestamp = 0;
	private fpsTimestamp = 0;
	private time = 0;

	constructor(options: {
		scheduler: FrameScheduler;
		onFrame: (timing: LiveFrameTiming) => void;
		fpsLimit: number | null;
		timeFactor: number;
	}) {
		this.scheduler = options.scheduler;
		this.onFrame = options.onFrame;
		this.fpsLimit = options.fpsLimit;
		this.timeFactor = options.timeFactor;
	}

	public start() {
		this.stop();
		this.running = true;
		this.latestTimestamp = this.scheduler.now();
		// FPS制限の位相と境界の判定は従来のループに合わせる。
		this.fpsTimestamp = 0;
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

	// 1フレームだけ進める。次回の予約は行わないため、テストでも任意の時刻を渡せる。
	public renderFrame(timestamp: number) {
		if (!this.running) return;
		const delta = timestamp - this.fpsTimestamp;
		if (this.fpsLimit != null) {
			const interval = 1000 / this.fpsLimit;
			if (delta <= interval) return;
			this.fpsTimestamp = timestamp - (delta % interval);
		}

		const realTimeDelta = timestamp - this.latestTimestamp;
		const timeDelta = realTimeDelta * this.timeFactor;
		this.time += timeDelta;
		// スキップしたフレームの時間も含め、出力の有無によらず描画前に時刻を更新する。
		this.latestTimestamp = timestamp;
		this.onFrame({ time: this.time, timeDelta, realTimeDelta });
	}
}
