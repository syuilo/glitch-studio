import { computed, readonly, ref, shallowRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { getTimelinePreviewFrameIndex, getTimelinePreviewFrameTime } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import type { TimelinePreviewSeekMode } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { VisualModuleArgumentBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModuleRendererManagerController } from './VisualModuleRendererManagerController.ts';
import type { TimelineRendererManagerController } from './TimelineRendererManagerController.ts';

export type PreviewPlaybackState =
	| { mode: 'visualModuleLivePreview'; visualModuleId: ProjectVisualModule['id'] }
	| { mode: 'timeline'; playing: boolean };

type VisualModuleLivePreviewRenderer = Pick<VisualModuleRendererManagerController, 'startVisualModuleLivePreviewRenderLoopFor' | 'updateVisualModuleLivePreviewParamValues' | 'stopRenderLoop'>;
type TimelineAudio = {
	start(time: number, duration: number): void;
	stop(): void;
	currentTime(): number;
	error: { value: string | null };
};
type TimelineRenderer = Pick<TimelineRendererManagerController, 'renderTimelineAt' | 'renderTimelineAtAndWait' | 'cancelSeek' | 'isReady' | 'errorMessage' | 'isFrameCacheEnabled'>;

/** プレビューの切り替えと時刻更新を所有し、Visual Module Live Previewとタイムラインの同時再生を防ぐ。 */
export class PreviewPlaybackController {
	private readonly playbackState = shallowRef<PreviewPlaybackState>({ mode: 'timeline', playing: false });
	private readonly timelineTime = ref(0);
	private timelineRafId: number | null = null;
	private pendingTimelineSeek = false;
	private timelineSeekMode: TimelinePreviewSeekMode = 'frame';
	private lastTimelinePreviewRequest: { time: number; seekMode: TimelinePreviewSeekMode } | null = null;
	private readonly suspended = ref(false);
	private readonly timelineBake = shallowRef<{ stopRequested: boolean } | null>(null);
	private visualModuleLivePreviewParams: VisualModuleArgumentBindings = {};

	public readonly state = readonly(this.playbackState);
	public readonly currentTimelineTime = readonly(this.timelineTime);
	public readonly isTimelinePlaying = computed(() => !this.suspended.value && this.playbackState.value.mode === 'timeline' && this.playbackState.value.playing);
	public readonly isTimelineBaking = computed(() => this.timelineBake.value != null);
	public readonly visualModuleLivePreviewVisualModuleId = computed(() => this.playbackState.value.mode === 'visualModuleLivePreview' ? this.playbackState.value.visualModuleId : null);

	constructor(
		private readonly visualModuleLivePreviewRenderer: VisualModuleLivePreviewRenderer,
		private readonly timelineRenderer: TimelineRenderer,
		private readonly getTimelinePreviewFps: () => number | null,
		private readonly getDuration: () => number = () => Infinity,
		private readonly audio?: TimelineAudio,
		private readonly onVisualModuleLivePreviewInputsChanged?: (visualModuleId: string, params: VisualModuleArgumentBindings) => void,
	) {}

	public startVisualModuleLivePreview(visualModuleId: ProjectVisualModule['id'], params: VisualModuleArgumentBindings = {}) {
		this.pendingTimelineSeek = false;
		this.timelineRenderer.cancelSeek();
		this.pauseTimeline();
		this.visualModuleLivePreviewParams = deepClone(params);
		this.onVisualModuleLivePreviewInputsChanged?.(visualModuleId, params);
		if (!this.suspended.value) this.visualModuleLivePreviewRenderer.startVisualModuleLivePreviewRenderLoopFor(visualModuleId, params);
		this.playbackState.value = { mode: 'visualModuleLivePreview', visualModuleId };
	}

	public updateVisualModuleLivePreviewParamValues(visualModuleId: ProjectVisualModule['id'], params: VisualModuleArgumentBindings) {
		if (this.visualModuleLivePreviewVisualModuleId.value !== visualModuleId) {
			this.startVisualModuleLivePreview(visualModuleId, params);
			return;
		}
		this.visualModuleLivePreviewParams = deepClone(params);
		this.onVisualModuleLivePreviewInputsChanged?.(visualModuleId, params);
		if (!this.suspended.value) this.visualModuleLivePreviewRenderer.updateVisualModuleLivePreviewParamValues(visualModuleId, params);
	}

	public playTimeline() {
		this.cancelTimelineBake();
		if (this.isTimelinePlaying.value) return;
		this.pendingTimelineSeek = false;
		this.timelineRenderer.cancelSeek();
		this.leaveVisualModuleLivePreview();
		// 同じエラー文は再通知されない。既に失敗している場合は描画の再試行だけを行い、
		// 成功でエラーが解除されるまで音声時計を開始しない。
		if (this.timelineRenderer.errorMessage.value) { this.refresh(); return; }
		const duration = this.getDuration();
		if (duration <= 0) return;
		if (this.timelineTime.value >= duration) this.timelineTime.value = 0;
		this.timelineSeekMode = 'frame';
		this.timelineTime.value = this.snapTimelineTime(this.timelineTime.value);
		this.playbackState.value = { mode: 'timeline', playing: true };
		if (this.suspended.value) return;
		this.audio?.start(this.timelineTime.value, duration);
		this.refresh();

		let previousAdvanceTime: number | null = null;
		const renderLoop = (timestamp: number) => {
			if (!this.isTimelinePlaying.value) return;
			// エラー文の変化ではなく現在の状態を見る。同じ表示フレームの間も停止できるようにする。
			if (this.audio?.error.value || this.timelineRenderer.errorMessage.value) { this.pauseTimeline(); return; }
			this.timelineRafId = window.requestAnimationFrame(renderLoop);
			if (previousAdvanceTime == null) {
				// 停止中の実時間を再生時刻へ加算しない。
				previousAdvanceTime = timestamp;
				return;
			}
			const nextTime = this.audio ? this.audio.currentTime() : (this.timelineTime.value + timestamp - previousAdvanceTime) % this.getDuration();
			this.timelineSeekMode = 'frame';
			// RAFの間隔でもFPS制限すると、音声時計との位相差や浮動小数点の誤差で
			// フレーム境界を逃す。毎RAFで時計を読み、表示フレームが変わった時だけ要求する。
			const previousRequest = this.lastTimelinePreviewRequest;
			if (previousRequest?.seekMode === 'frame' && previousRequest.time === this.getTimelineRenderTime(nextTime)) return;
			// 低FPS設定でUI全体を毎RAF更新しない。音声がない場合の経過時間は、
			// 最後に反映した時刻からまとめて加算し、省略したRAFの時間も保持する。
			this.timelineTime.value = nextTime;
			previousAdvanceTime = timestamp;
			this.refresh();
		};
		this.timelineRafId = window.requestAnimationFrame(renderLoop);
	}

	public pauseTimeline() {
		this.stopTimelinePlayback();
		this.refresh();
	}

	/** 停止と表示時刻の丸めを分け、コマ送りは丸め前の音声時刻から移動先を決める。 */
	private stopTimelinePlayback() {
		this.cancelTimelineBake();
		if (this.isTimelinePlaying.value && this.audio) this.timelineTime.value = this.audio.currentTime();
		this.audio?.stop();
		if (this.timelineRafId != null) {
			window.cancelAnimationFrame(this.timelineRafId);
			this.timelineRafId = null;
		}
		if (this.playbackState.value.mode === 'timeline') {
			this.playbackState.value = { mode: 'timeline', playing: false };
		}
	}

	public showTimeline() {
		this.leaveVisualModuleLivePreview();
		this.refresh();
	}

	public seekTimeline(time: number, isManualSeek = true, seekMode: TimelinePreviewSeekMode = 'frame') {
		this.cancelTimelineBake();
		this.leaveVisualModuleLivePreview();
		this.timelineSeekMode = seekMode;
		this.timelineTime.value = seekMode === 'precise' ? Math.max(0, time) : this.snapTimelineTime(time);
		this.pendingTimelineSeek = isManualSeek && !this.isTimelinePlaying.value;
		if (this.isTimelinePlaying.value) this.audio?.start(this.timelineTime.value, this.getDuration());
		this.refresh();
	}

	private snapTimelineTime(time: number): number {
		const fps = this.getTimelinePreviewFps();
		if (fps == null || fps <= 0) return Math.max(0, time);
		const snapped = getTimelinePreviewFrameTime(time, fps);
		const duration = this.getDuration();
		// 終端は再生区間外。区間内からの通常シークだけを最終フレームへ制限し、
		// 区間外にも置けるキーフレームへのジャンプは引き続き許可する。
		return time <= duration && Number.isFinite(duration) && duration > 0
			? Math.min(snapped, Math.max(0, Math.ceil(duration * fps / 1000) - 1) * 1000 / fps) : snapped;
	}

	public stepTimelineFrame(direction: -1 | 1) {
		this.stopTimelinePlayback();
		const fps = this.getTimelinePreviewFps();
		if (fps == null || fps <= 0) return;
		// 精密位置からも隣の境界へ進む。四捨五入してから加減すると一枚飛ばしてしまう。
		const position = this.timelineTime.value * fps / 1000;
		const frame = direction === 1 ? Math.floor(position + 1e-7) + 1 : Math.ceil(position - 1e-7) - 1;
		this.seekTimeline(Math.min(this.getDuration(), Math.max(0, frame) * 1000 / fps));
	}

	/** 実時間の時計を使わず、GPU完了ごとにプレビューの次のフレームを要求する。 */
	public async toggleTimelineBake(): Promise<void> {
		const currentBake = this.timelineBake.value;
		if (currentBake != null) {
			// 送信済みの描画は取り消せない。再押下では一枚の完了を待って止める。
			currentBake.stopRequested = true;
			return;
		}
		const fps = this.getTimelinePreviewFps();
		const duration = this.getDuration();
		if (this.suspended.value || !this.timelineRenderer.isReady.value || !this.timelineRenderer.isFrameCacheEnabled.value
			|| this.timelineRenderer.errorMessage.value != null || fps == null || !Number.isFinite(fps) || fps <= 0
			|| !Number.isFinite(duration) || duration <= 0) return;
		this.stopTimelinePlayback();
		this.leaveVisualModuleLivePreview();
		this.pendingTimelineSeek = false;
		this.timelineRenderer.cancelSeek();
		if (this.timelineTime.value >= duration) return;
		this.timelineSeekMode = 'frame';
		const endFrame = Math.ceil(duration * fps / 1000);
		const startFrame = Math.min(endFrame - 1, getTimelinePreviewFrameIndex(this.timelineTime.value, fps));
		const bake = { stopRequested: false };
		this.timelineBake.value = bake;
		try {
			for (let frame = startFrame; frame < endFrame; frame++) {
				if (this.timelineBake.value !== bake || bake.stopRequested) break;
				// 加算を繰り返すと誤差が蓄積するため、常に整数の番号から境界を求める。
				// キャッシュの有無は通常描画へ委ね、LRUもそのまま適用する。
				const time = frame * 1000 / fps;
				this.timelineTime.value = time;
				if (!await this.timelineRenderer.renderTimelineAtAndWait(time)) break;
			}
		} finally {
			// 通常操作から新しいBAKEが始まっていても、古い待機の終了で止めない。
			if (this.timelineBake.value === bake) this.timelineBake.value = null;
		}
	}

	public cancelTimelineBake() {
		if (this.timelineBake.value == null) return;
		this.timelineBake.value = null;
		this.timelineRenderer.cancelSeek();
	}

	public updateTimelinePreviewFps() {
		this.timelineSeekMode = 'frame';
		if (!this.isTimelinePlaying.value) this.timelineTime.value = this.snapTimelineTime(this.timelineTime.value);
		this.refresh();
	}

	/** 編集・Undo/Redoでは旧PCMを破棄し、実際に聞こえていた位置から生成し直す。 */
	public refreshAudio() {
		this.cancelTimelineBake();
		if (!this.isTimelinePlaying.value) return;
		if (this.getDuration() <= 0) { this.pauseTimeline(); return; }
		if (this.audio) this.timelineTime.value = this.audio.currentTime() % this.getDuration();
		this.audio?.start(this.timelineTime.value, this.getDuration());
	}

	/** 編集による再描画では表示モードを切り替えない。Visual Module Live PreviewはWorkerのループが描画する。 */
	public refresh() {
		this.cancelTimelineBake();
		if (!this.suspended.value && this.playbackState.value.mode === 'timeline' && this.timelineRenderer.isReady.value) {
			// 音声時計自体は丸めない。表示する画像だけを現在位置以前の境界に揃え、
			// 停止中はカーソルの時刻も描画時刻に一致させる。
			const precise = this.timelineSeekMode === 'precise';
			const renderTime = this.getTimelineRenderTime(this.timelineTime.value);
			if (!this.isTimelinePlaying.value && !precise) this.timelineTime.value = renderTime;
			// 編集・シーク・Worker再生成後の明示的なrefreshは、同じフレームでも必ず描き直す。
			this.lastTimelinePreviewRequest = { time: renderTime, seekMode: this.timelineSeekMode };
			if (precise) {
				const manualSeek = this.pendingTimelineSeek;
				this.pendingTimelineSeek = false;
				this.timelineRenderer.renderTimelineAt(renderTime, manualSeek, 'precise');
				return;
			}
			if (this.pendingTimelineSeek) {
				this.pendingTimelineSeek = false;
				this.timelineRenderer.renderTimelineAt(renderTime, true);
			} else this.timelineRenderer.renderTimelineAt(renderTime);
		}
	}

	private getTimelineRenderTime(time: number): number {
		const fps = this.getTimelinePreviewFps();
		if (this.timelineSeekMode === 'precise' || fps == null || fps <= 0) return time;
		return this.isTimelinePlaying.value
			? Math.max(0, Math.floor(time * fps / 1000 + 1e-7)) * 1000 / fps : this.snapTimelineTime(time);
	}

	/** Workerを解放する間も、表示モードと再開位置を保持する。 */
	public suspend() {
		this.cancelTimelineBake();
		if (this.suspended.value) return;
		this.timelineRenderer.cancelSeek();
		if (this.isTimelinePlaying.value && this.audio) this.timelineTime.value = this.audio.currentTime();
		this.audio?.stop();
		if (this.timelineRafId != null) window.cancelAnimationFrame(this.timelineRafId);
		this.timelineRafId = null;
		if (this.playbackState.value.mode === 'visualModuleLivePreview') this.visualModuleLivePreviewRenderer.stopRenderLoop();
		this.suspended.value = true;
	}

	public resume() {
		if (!this.suspended.value) return;
		this.suspended.value = false;
		const state = this.playbackState.value;
		if (state.mode === 'visualModuleLivePreview') {
			this.visualModuleLivePreviewRenderer.startVisualModuleLivePreviewRenderLoopFor(state.visualModuleId, this.visualModuleLivePreviewParams);
		} else if (state.playing) {
			this.playbackState.value = { mode: 'timeline', playing: false };
			this.playTimeline();
		} else {
			this.refresh();
		}
	}

	public dispose() {
		this.pendingTimelineSeek = false;
		this.timelineRenderer.cancelSeek();
		this.pauseTimeline();
		this.leaveVisualModuleLivePreview();
		this.suspended.value = false;
	}

	private leaveVisualModuleLivePreview() {
		if (this.playbackState.value.mode !== 'visualModuleLivePreview') return;
		if (!this.suspended.value) this.visualModuleLivePreviewRenderer.stopRenderLoop();
		this.playbackState.value = { mode: 'timeline', playing: false };
	}
}
