import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import { computed, readonly, ref, shallowRef } from 'vue';
import type { VisualModuleParameterBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { VisualModuleRendererManagerController } from './VisualModuleRendererManagerController.ts';
import type { TimelineRendererManagerController } from './TimelineRendererManagerController.ts';

export type PreviewPlaybackState =
	| { mode: 'live'; visualModuleId: ProjectVisualModule['id'] }
	| { mode: 'timeline'; playing: boolean };

type LiveRenderer = Pick<VisualModuleRendererManagerController, 'startLiveRenderLoopFor' | 'updateLiveParamValues' | 'stopRenderLoop'>;
type TimelineAudio = {
	start(time: number, duration: number): void;
	stop(): void;
	currentTime(): number;
	error: { value: string | null };
};
type TimelineRenderer = Pick<TimelineRendererManagerController, 'renderTimelineAt' | 'isReady' | 'errorMessage'>;

/** プレビューの切り替えと時刻更新を所有し、LIVEとタイムラインの同時再生を防ぐ。 */
export class PreviewPlaybackController {
	private readonly playbackState = shallowRef<PreviewPlaybackState>({ mode: 'timeline', playing: false });
	private readonly timelineTime = ref(0);
	private timelineRafId: number | null = null;
	private readonly suspended = ref(false);
	private liveParams: VisualModuleParameterBindings = {};

	public readonly state = readonly(this.playbackState);
	public readonly currentTimelineTime = readonly(this.timelineTime);
	public readonly isTimelinePlaying = computed(() => !this.suspended.value && this.playbackState.value.mode === 'timeline' && this.playbackState.value.playing);
	public readonly liveVisualModuleId = computed(() => this.playbackState.value.mode === 'live' ? this.playbackState.value.visualModuleId : null);

	constructor(
		private readonly liveRenderer: LiveRenderer,
		private readonly timelineRenderer: TimelineRenderer,
		private readonly getFpsLimit: () => number | null,
		private readonly getDuration: () => number = () => Infinity,
		private readonly audio?: TimelineAudio,
	) {}

	public startLive(visualModuleId: ProjectVisualModule['id'], params: VisualModuleParameterBindings = {}) {
		this.pauseTimeline();
		this.liveParams = deepClone(params);
		if (!this.suspended.value) this.liveRenderer.startLiveRenderLoopFor(visualModuleId, params);
		this.playbackState.value = { mode: 'live', visualModuleId };
	}

	public updateLiveParamValues(visualModuleId: ProjectVisualModule['id'], params: VisualModuleParameterBindings) {
		if (this.liveVisualModuleId.value !== visualModuleId) {
			this.startLive(visualModuleId, params);
			return;
		}
		this.liveParams = deepClone(params);
		if (!this.suspended.value) this.liveRenderer.updateLiveParamValues(visualModuleId, params);
	}

	public playTimeline() {
		if (this.isTimelinePlaying.value) return;
		this.leaveLive();
		// 同じエラー文は再通知されない。既に失敗している場合は描画の再試行だけを行い、
		// 成功でエラーが解除されるまで音声時計を開始しない。
		if (this.timelineRenderer.errorMessage.value) { this.refresh(); return; }
		const duration = this.getDuration();
		if (duration <= 0) return;
		if (this.timelineTime.value >= duration) this.timelineTime.value = 0;
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
			const fpsLimit = this.getFpsLimit();
			if (fpsLimit != null && fpsLimit > 0) {
				const interval = 1000 / fpsLimit;
				if (delta < interval) return;
				previousFrameTime = timestamp - (delta % interval);
			} else {
				previousFrameTime = timestamp;
			}
			// FPS制限の余りは描画タイミングだけに使い、経過時間を二重加算しない。
			this.timelineTime.value = this.audio ? this.audio.currentTime() : (this.timelineTime.value + timestamp - previousAdvanceTime) % this.getDuration();
			previousAdvanceTime = timestamp;
			this.refresh(true);
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
		this.leaveLive();
		this.refresh();
	}

	public seekTimeline(time: number) {
		this.leaveLive();
		this.timelineTime.value = Math.max(0, time);
		if (this.isTimelinePlaying.value) this.audio?.start(this.timelineTime.value, this.getDuration());
		this.refresh();
	}

	/** 編集・Undo/Redoでは旧PCMを破棄し、実際に聞こえていた位置から生成し直す。 */
	public refreshAudio() {
		if (!this.isTimelinePlaying.value) return;
		if (this.getDuration() <= 0) { this.pauseTimeline(); return; }
		if (this.audio) this.timelineTime.value = this.audio.currentTime() % this.getDuration();
		this.audio?.start(this.timelineTime.value, this.getDuration());
	}

	/** 編集による再描画では表示モードを切り替えない。LIVEはWorkerのループが描画する。 */
	public refresh(playbackFrame = false) {
		if (!this.suspended.value && this.playbackState.value.mode === 'timeline' && this.timelineRenderer.isReady.value) {
			this.timelineRenderer.renderTimelineAt(this.timelineTime.value, playbackFrame);
		}
	}

	/** Workerを解放する間も、表示モードと再開位置を保持する。 */
	public suspend() {
		if (this.suspended.value) return;
		if (this.isTimelinePlaying.value && this.audio) this.timelineTime.value = this.audio.currentTime();
		this.audio?.stop();
		if (this.timelineRafId != null) window.cancelAnimationFrame(this.timelineRafId);
		this.timelineRafId = null;
		if (this.playbackState.value.mode === 'live') this.liveRenderer.stopRenderLoop();
		this.suspended.value = true;
	}

	public resume() {
		if (!this.suspended.value) return;
		this.suspended.value = false;
		const state = this.playbackState.value;
		if (state.mode === 'live') {
			this.liveRenderer.startLiveRenderLoopFor(state.visualModuleId, this.liveParams);
		} else if (state.playing) {
			this.playbackState.value = { mode: 'timeline', playing: false };
			this.playTimeline();
		} else {
			this.refresh();
		}
	}

	public dispose() {
		this.pauseTimeline();
		this.leaveLive();
		this.suspended.value = false;
	}

	private leaveLive() {
		if (this.playbackState.value.mode !== 'live') return;
		if (!this.suspended.value) this.liveRenderer.stopRenderLoop();
		this.playbackState.value = { mode: 'timeline', playing: false };
	}
}
