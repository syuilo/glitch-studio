import { computed, readonly, ref, shallowRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { getTimelinePreviewFrameTime } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
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
type TimelineRenderer = Pick<TimelineRendererManagerController, 'renderTimelineAt' | 'cancelSeek' | 'isReady' | 'errorMessage'>;

/** プレビューの切り替えと時刻更新を所有し、Visual Module Live Previewとタイムラインの同時再生を防ぐ。 */
export class PreviewPlaybackController {
	private readonly playbackState = shallowRef<PreviewPlaybackState>({ mode: 'timeline', playing: false });
	private readonly timelineTime = ref(0);
	private timelineRafId: number | null = null;
	private pendingTimelineSeek = false;
	private timelineSeekMode: TimelinePreviewSeekMode = 'frame';
	private readonly suspended = ref(false);
	private visualModuleLivePreviewParams: VisualModuleArgumentBindings = {};

	public readonly state = readonly(this.playbackState);
	public readonly currentTimelineTime = readonly(this.timelineTime);
	public readonly isTimelinePlaying = computed(() => !this.suspended.value && this.playbackState.value.mode === 'timeline' && this.playbackState.value.playing);
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

		let previousFrameTime: number | null = null;
		let previousAdvanceTime: number | null = null;
		const renderLoop = (timestamp: number) => {
			if (!this.isTimelinePlaying.value) return;
			// エラー文の変化ではなく現在の状態を見る。FPS制限中・初回RAFでも停止する。
			if (this.audio?.error.value || this.timelineRenderer.errorMessage.value) { this.pauseTimeline(); return; }
			this.timelineRafId = window.requestAnimationFrame(renderLoop);
			if (previousFrameTime == null || previousAdvanceTime == null) {
				// 停止中の実時間を再生時刻へ加算しない。
				previousFrameTime = previousAdvanceTime = timestamp;
				return;
			}
			const delta = timestamp - previousFrameTime;
			const timelinePreviewFps = this.getTimelinePreviewFps();
			if (timelinePreviewFps != null && timelinePreviewFps > 0) {
				const interval = 1000 / timelinePreviewFps;
				if (delta < interval) return;
				previousFrameTime = timestamp - (delta % interval);
			} else {
				previousFrameTime = timestamp;
			}
			// FPS制限の余りは描画タイミングだけに使い、経過時間を二重加算しない。
			this.timelineTime.value = this.audio ? this.audio.currentTime() : (this.timelineTime.value + timestamp - previousAdvanceTime) % this.getDuration();
			previousAdvanceTime = timestamp;
			this.timelineSeekMode = 'frame';
			this.refresh();
		};
		this.timelineRafId = window.requestAnimationFrame(renderLoop);
	}

	public pauseTimeline() {
		if (this.isTimelinePlaying.value && this.audio) this.timelineTime.value = this.audio.currentTime();
		this.audio?.stop();
		if (this.timelineRafId != null) {
			window.cancelAnimationFrame(this.timelineRafId);
			this.timelineRafId = null;
		}
		if (this.playbackState.value.mode === 'timeline') {
			this.playbackState.value = { mode: 'timeline', playing: false };
			this.refresh();
		}
	}

	public showTimeline() {
		this.leaveVisualModuleLivePreview();
		this.refresh();
	}

	public seekTimeline(time: number, isManualSeek = true, seekMode: TimelinePreviewSeekMode = 'frame') {
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
		this.pauseTimeline();
		const fps = this.getTimelinePreviewFps();
		if (fps == null || fps <= 0) return;
		// 精密位置からも隣の境界へ進む。四捨五入してから加減すると一枚飛ばしてしまう。
		const position = this.timelineTime.value * fps / 1000;
		const frame = direction === 1 ? Math.floor(position + 1e-7) + 1 : Math.ceil(position - 1e-7) - 1;
		this.seekTimeline(Math.min(this.getDuration(), Math.max(0, frame) * 1000 / fps));
	}

	public updateTimelinePreviewFps() {
		this.timelineSeekMode = 'frame';
		if (!this.isTimelinePlaying.value) this.timelineTime.value = this.snapTimelineTime(this.timelineTime.value);
		this.refresh();
	}

	/** 編集・Undo/Redoでは旧PCMを破棄し、実際に聞こえていた位置から生成し直す。 */
	public refreshAudio() {
		if (!this.isTimelinePlaying.value) return;
		if (this.getDuration() <= 0) { this.pauseTimeline(); return; }
		if (this.audio) this.timelineTime.value = this.audio.currentTime() % this.getDuration();
		this.audio?.start(this.timelineTime.value, this.getDuration());
	}

	/** 編集による再描画では表示モードを切り替えない。Visual Module Live PreviewはWorkerのループが描画する。 */
	public refresh() {
		if (!this.suspended.value && this.playbackState.value.mode === 'timeline' && this.timelineRenderer.isReady.value) {
			const fps = this.getTimelinePreviewFps();
			// 音声時計自体は丸めない。表示する画像だけを現在位置以前の境界に揃え、
			// 停止中はカーソルの時刻も描画時刻に一致させる。
			const precise = this.timelineSeekMode === 'precise';
			const renderTime = precise || fps == null || fps <= 0 ? this.timelineTime.value : this.isTimelinePlaying.value
				? Math.max(0, Math.floor(this.timelineTime.value * fps / 1000 + 1e-7)) * 1000 / fps : this.snapTimelineTime(this.timelineTime.value);
			if (!this.isTimelinePlaying.value && !precise) this.timelineTime.value = renderTime;
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

	/** Workerを解放する間も、表示モードと再開位置を保持する。 */
	public suspend() {
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
