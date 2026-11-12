import type { EffectRenderTilingProgress } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';

const RENDER_DELAY_THRESHOLD_MS = 300;
const RENDER_DELAY_CHECK_INTERVAL_MS = 100;

/** プレビューの未完了フレームを監視し、遅延とタイル進捗を同じ頻度で通知する。 */
export class PreviewRenderDelayMonitor {
	private readonly frames = new Map<object, { startedAt: number; tilingProgress: EffectRenderTilingProgress | null }>();
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private isDelayed = false;
	private publishedTilingProgress: EffectRenderTilingProgress | null = null;
	private readonly onDelayChanged: (isDelayed: boolean, tilingProgress: EffectRenderTilingProgress | null) => void;

	constructor(onDelayChanged: (isDelayed: boolean, tilingProgress: EffectRenderTilingProgress | null) => void) {
		this.onDelayChanged = onDelayChanged;
	}

	public beginFrame(frame: object) {
		// 準備待ちを同じフレームで再確認しても、開始時刻を更新しない。
		if (this.frames.has(frame)) return;
		this.frames.set(frame, { startedAt: performance.now(), tilingProgress: null });
		// 完了のたびには解除せず、プレビューの停止まで一つのタイマーを共有する。
		// 高fpsでも毎フレームのタイマー予約・取消を発生させないため。
		this.intervalId ??= setInterval(() => this.checkDelay(), RENDER_DELAY_CHECK_INTERVAL_MS);
	}

	public updateTilingProgress(frame: object, progress: EffectRenderTilingProgress | null) {
		// タイルごとのWorker通信はせず、次の100ms監視時に最新値だけを送る。
		// 切替・中断で監視対象から外したフレームの遅い通知もここで捨てる。
		const tracked = this.frames.get(frame);
		if (tracked != null) tracked.tilingProgress = progress;
	}

	public completeFrame(frame: object) {
		// 中断・対象切替で消したフレームの遅い完了は、現在の状態へ干渉させない。
		if (!this.frames.delete(frame)) return;
		if (this.isDelayed) this.checkDelay();
	}

	public clear() {
		this.frames.clear();
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
		const oldestFrame = this.frames.values().next().value;
		const isDelayed = oldestFrame != null && performance.now() - oldestFrame.startedAt >= RENDER_DELAY_THRESHOLD_MS;
		this.setDelayed(isDelayed, isDelayed ? oldestFrame.tilingProgress : null);
	}

	private setDelayed(isDelayed: boolean, tilingProgress: EffectRenderTilingProgress | null = null) {
		if (this.isDelayed === isDelayed && this.publishedTilingProgress?.completedTiles === tilingProgress?.completedTiles
			&& this.publishedTilingProgress?.totalTiles === tilingProgress?.totalTiles) return;
		this.isDelayed = isDelayed;
		this.publishedTilingProgress = tilingProgress;
		this.onDelayChanged(isDelayed, tilingProgress);
	}
}
