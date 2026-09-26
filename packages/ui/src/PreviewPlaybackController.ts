import { computed, readonly, ref, shallowRef } from 'vue';
import type { VisualModule, VisualModuleParameterBindings } from '@glitch/shared/visual-module/types.ts';
import type { RendererController } from './RendererController.ts';

export type PreviewPlaybackState =
	| { mode: 'live'; visualModuleId: VisualModule['id'] }
	| { mode: 'timeline'; playing: boolean };

type PreviewRenderer = Pick<RendererController, 'startLiveRenderLoopFor' | 'updateLiveParamValues' | 'stopRenderLoop' | 'renderTimelineAt'>;

/** プレビューの切り替えと時刻更新を所有し、LIVEとタイムラインの同時再生を防ぐ。 */
export class PreviewPlaybackController {
	private readonly playbackState = shallowRef<PreviewPlaybackState>({ mode: 'timeline', playing: false });
	private readonly timelineTime = ref(0);
	private timelineRafId: number | null = null;

	public readonly state = readonly(this.playbackState);
	public readonly currentTimelineTime = readonly(this.timelineTime);
	public readonly isTimelinePlaying = computed(() => this.playbackState.value.mode === 'timeline' && this.playbackState.value.playing);
	public readonly liveVisualModuleId = computed(() => this.playbackState.value.mode === 'live' ? this.playbackState.value.visualModuleId : null);

	constructor(private readonly renderer: PreviewRenderer, private readonly getFpsLimit: () => number | null) {}

	public startLive(visualModuleId: VisualModule['id'], params: VisualModuleParameterBindings = {}) {
		this.pauseTimeline();
		this.renderer.startLiveRenderLoopFor(visualModuleId, params);
		this.playbackState.value = { mode: 'live', visualModuleId };
	}

	public updateLiveParamValues(visualModuleId: VisualModule['id'], params: VisualModuleParameterBindings) {
		if (this.liveVisualModuleId.value !== visualModuleId) {
			this.startLive(visualModuleId, params);
			return;
		}
		this.renderer.updateLiveParamValues(visualModuleId, params);
	}

	public playTimeline() {
		if (this.isTimelinePlaying.value) return;
		this.leaveLive();
		this.playbackState.value = { mode: 'timeline', playing: true };
		this.refresh();

		let previousFrameTime: number | null = null;
		let previousAdvanceTime: number | null = null;
		const renderLoop = (timestamp: number) => {
			if (!this.isTimelinePlaying.value) return;
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
			this.timelineTime.value = (this.timelineTime.value + timestamp - previousAdvanceTime) % 10000;
			previousAdvanceTime = timestamp;
			this.refresh();
		};
		this.timelineRafId = window.requestAnimationFrame(renderLoop);
	}

	public pauseTimeline() {
		if (this.timelineRafId != null) {
			window.cancelAnimationFrame(this.timelineRafId);
			this.timelineRafId = null;
		}
		if (this.isTimelinePlaying.value) this.playbackState.value = { mode: 'timeline', playing: false };
	}

	public seekTimeline(time: number) {
		this.leaveLive();
		this.timelineTime.value = time;
		this.refresh();
	}

	/** 編集による再描画では表示モードを切り替えない。LIVEはWorkerのループが描画する。 */
	public refresh() {
		if (this.playbackState.value.mode === 'timeline') this.renderer.renderTimelineAt(this.timelineTime.value);
	}

	public dispose() {
		this.pauseTimeline();
		this.leaveLive();
	}

	private leaveLive() {
		if (this.playbackState.value.mode !== 'live') return;
		this.renderer.stopRenderLoop();
		this.playbackState.value = { mode: 'timeline', playing: false };
	}
}
