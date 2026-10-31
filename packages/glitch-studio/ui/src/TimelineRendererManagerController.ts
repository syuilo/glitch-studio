import { computed, ref, shallowRef } from 'vue';
import type { TimelineTransformPreview } from '@gs/glitch-studio_shared/timeline-transform-preview.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { createTimelineRendererManagerWorker } from '@gs/glitch-studio_renderer/client.ts';
import { RendererManagerControllerBase } from './RendererManagerControllerBase.ts';
import { TimelineEffectStateStore } from './utility/timeline-effect-status.ts';
import { displayCpuPreviewFrame } from './utility/cpu-preview-display.ts';
import type { TimelineRendererManager, TimelineRendererManagerResources, TimelineRendererManagerStaticOptions, TimelineRendererManagerDynamicOptions, TimelinePreviewStatistics } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { TimelinePreviewFrameCacheState, TimelinePreviewSeekMode } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import { getTimelinePreviewFrameIndex } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';

export type TimelineRendererManagerInitialOptions = {
	staticOptions: TimelineRendererManagerStaticOptions;
	dynamicOptions: Partial<TimelineRendererManagerDynamicOptions>;
	resources: TimelineRendererManagerResources;
};

type TimelineRendererManagerRuntimeOptions = Omit<TimelineRendererManagerDynamicOptions, 'automationGraphs' | 'visualModules' | 'timelineScenes'>;

export class TimelineRendererManagerController extends RendererManagerControllerBase<TimelineRendererManager> {
	public readonly canvasRevision = ref(0);
	public readonly layerTransform = shallowRef<TimelineTransformPreview | null>(null);
	public get transformPreviewRevision() { return this.dynamicOptions.previewRevision ?? 0; }
	public readonly previewStatistics = shallowRef<TimelinePreviewStatistics | null>(null);
	public readonly frameCacheState = shallowRef<TimelinePreviewFrameCacheState | null>(null);
	private readonly frameCacheMaxBytes = ref(0);
	public readonly isFrameCacheEnabled = computed(() => this.frameCacheMaxBytes.value > 0);
	public readonly frameCacheUsageRatio = computed(() => {
		const cache = this.frameCacheState.value;
		return cache != null && cache.maxBytes > 0 ? cache.estimatedBytes / cache.maxBytes : null;
	});
	private seekRequestId = 0;
	private pendingSeek = shallowRef<{ requestId: number; time: number } | null>(null);
	private pendingFrameCompletion: { requestId: number; time: number; resolve: (completed: boolean) => void } | null = null;
	public readonly isSeeking = computed(() => this.pendingSeek.value != null);
	private transformRequestId = 0;
	private transformObservers = new Map<object, { sceneId: string; layerId: string }>();
	public canvas: HTMLCanvasElement;
	public histogramCanvas: HTMLCanvasElement;
	public waveformHorizontalCanvas: HTMLCanvasElement;
	public waveformVerticalCanvas: HTMLCanvasElement;
	private timelineFps = 60;
	/** 再生・通知の照合に必要なUI側の情報だけを保持し、プロジェクトや素材を複製しない。 */
	private dynamicOptions: Partial<Pick<TimelineRendererManagerRuntimeOptions, 'sceneId' | 'previewFps' | 'previewRevision' | 'transformObserver'>> = {
		previewRevision: 0,
	};
	public errorMessage = ref<string | null>(null);
	private effectStates = new TimelineEffectStateStore();

	public getLayerEffectStates(sceneId: string, layerId: string): ReadonlyMap<string, EffectInstanceState> | null {
		return this.effectStates.getNodes(sceneId, layerId);
	}

	public getEffectLayerState(sceneId: string, layerId: string): EffectInstanceState | null {
		return this.effectStates.getLayer(sceneId, layerId);
	}

	constructor() {
		super({
			createWorker: () => {
				return createTimelineRendererManagerWorker();
			},
			onError: error => {
				this.errorMessage.value = error?.message ?? null;
				if (error != null) this.cancelSeek();
			},
			eventHandlers: {
				cpuPreviewFrame: frame => {
					try { displayCpuPreviewFrame(this[frame.target], frame); } catch (error) { this.reportRenderFailure(error instanceof Error ? error : new Error(String(error))); } finally {
						if (this.isReady.value) this.call('recycleCpuPreviewPixels', [frame.target, frame.frameId, frame.pixels], [frame.pixels]);
					}
				},
				frameCache: ctx => {
					// UIの編集・設定世代では選別せず、最後に受信したWorkerの実状態を保持する。
					// 破棄済みWorkerからの通知は基底クラスのWorker世代チェックで除外される。
					this.frameCacheState.value = ctx;
				},
				telemetry: ctx => {
					if (this.isReady.value && ctx.sceneId === (this.dynamicOptions.sceneId ?? null) && ctx.revision === this.dynamicOptions.previewRevision) {
						this.previewStatistics.value = ctx;
					}
				},
				frameRendered: ctx => {
					if (!this.isReady.value || ctx.sceneId !== (this.dynamicOptions.sceneId ?? null) || ctx.revision !== this.dynamicOptions.previewRevision) return;
					const completion = this.pendingFrameCompletion;
					if (completion != null && ctx.requestId === completion.requestId && ctx.time === completion.time) this.finishFrameCompletion(true);
					const pending = this.pendingSeek.value;
					if (pending != null && ctx.requestId === pending.requestId && ctx.time === pending.time) this.cancelSeek();
				},
				layerTransform: ctx => {
					if (this.isReady.value && ctx.request.requestId === this.dynamicOptions.transformObserver?.requestId
						&& ctx.revision === this.dynamicOptions.previewRevision) this.layerTransform.value = ctx;
				},
				effectState: (ctx) => {
					if (ctx.status?.status.type === 'error') { this.reportRenderFailure(new Error(ctx.status.status.message), { source: ctx.source, nodeId: ctx.nodeId }); return; }
					if (this.isReady.value) this.effectStates.updateNode(ctx.source, ctx.nodeId, ctx.status);
				},
				effectLayerState: (ctx) => {
					if (ctx.status?.status.type === 'error') { this.reportRenderFailure(new Error(ctx.status.status.message), { source: ctx.source }); return; }
					if (this.isReady.value) this.effectStates.updateLayer(ctx.source, ctx.status);
				},
				renderError: (ctx) => {
					this.reportRenderFailure(new Error(ctx.message));
				},
			},
			onCreated: () => {},
			onDisposed: () => {
				this.frameCacheState.value = null;
				this.previewStatistics.value = null;
				this.cancelSeek();
				this.layerTransform.value = null;
				this.effectStates.clear();
			},
		});

		this.canvas = window.document.createElement('canvas');
		this.canvas.style.imageRendering = 'pixelated';
		this.histogramCanvas = window.document.createElement('canvas');
		this.histogramCanvas.width = 256;
		this.histogramCanvas.height = 150;
		this.histogramCanvas.style.width = '100%';
		this.histogramCanvas.style.height = '100%';
		this.waveformHorizontalCanvas = window.document.createElement('canvas');
		this.waveformHorizontalCanvas.width = 512;
		this.waveformHorizontalCanvas.height = 256;
		this.waveformHorizontalCanvas.style.width = '100%';
		this.waveformHorizontalCanvas.style.height = '100%';
		this.waveformVerticalCanvas = window.document.createElement('canvas');
		this.waveformVerticalCanvas.width = 256;
		this.waveformVerticalCanvas.height = 512;
		this.waveformVerticalCanvas.style.width = '100%';
		this.waveformVerticalCanvas.style.height = '100%';
	}

	/** 起動ごとに所有者が取得した最新スナップショットだけを使い、停止中の編集状態を複製しない。 */
	public async initialize(options: TimelineRendererManagerInitialOptions): Promise<void> {
		const snapshot = deepClone(options);
		await this.launchManager(() => {
			const previewRevision = this.transformPreviewRevision;
			const transformObserver = this.dynamicOptions.transformObserver ?? null;
			this.dynamicOptions = { sceneId: snapshot.dynamicOptions.sceneId, previewFps: snapshot.dynamicOptions.previewFps, transformObserver, previewRevision };
			this.timelineFps = snapshot.staticOptions.timelineFps;
			this.frameCacheMaxBytes.value = snapshot.dynamicOptions.frameCacheMaxBytes ?? 0;
			snapshot.dynamicOptions = { ...snapshot.dynamicOptions, ...this.dynamicOptions };
			// 転送済みcanvasは再転送できないため、起動ごとに属性を引き継いだcanvasを用意する。
			// 初回も同じ手順に揃え、表示先への付け替えはUIに通知する。
			for (const key of ['canvas', 'histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const) {
				const previous = this[key];
				this[key] = previous.cloneNode(false) as HTMLCanvasElement;
			}
			this.canvasRevision.value++;

			// CPU方式では実画面のCanvasをUIに残す。Workerには寸法を所有する描画先だけを渡す。
			const transferCanvas = (canvas: HTMLCanvasElement) => snapshot.staticOptions.previewDisplayMode === 'cpu'
				? new OffscreenCanvas(canvas.width, canvas.height) : canvas.transferControlToOffscreen();
			const offscreen = transferCanvas(this.canvas);
			const histogramOffscreen = transferCanvas(this.histogramCanvas);
			const waveformHorizontalOffscreen = transferCanvas(this.waveformHorizontalCanvas);
			const waveformVerticalOffscreen = transferCanvas(this.waveformVerticalCanvas);

			return {
				options: {
					canvas: offscreen,
					histogramCanvas: histogramOffscreen,
					waveformHorizontalCanvas: waveformHorizontalOffscreen,
					waveformVerticalCanvas: waveformVerticalOffscreen,
					staticOptions: snapshot.staticOptions,
					dynamicOptions: snapshot.dynamicOptions,
					resources: snapshot.resources,
				},
				transfer: [
					offscreen,
					histogramOffscreen,
					waveformHorizontalOffscreen,
					waveformVerticalOffscreen,
				],
			};
		});
		// 購読対象は起動中にも変わる。描画内容とは別に保持した最新のUI購読を適用する。
		if (snapshot.dynamicOptions.previewRevision !== this.transformPreviewRevision) {
			this.call('updateDynamicOptions', [{ transformObserver: this.dynamicOptions.transformObserver ?? null, previewRevision: this.transformPreviewRevision }]);
		}
	}

	public async updateDynamicOptions(newDynamicOptions: Partial<TimelineRendererManagerRuntimeOptions>) {
		const options = deepClone(newDynamicOptions);
		if (options.frameCacheMaxBytes != null) this.frameCacheMaxBytes.value = options.frameCacheMaxBytes;
		if (Object.hasOwn(options, 'sceneId') && options.sceneId !== this.dynamicOptions.sceneId) {
			this.cancelSeek();
			this.previewStatistics.value = null;
		}
		options.previewRevision = this.invalidateTransformPreview();
		// Partialのresolution省略は変更なし。指定された場合だけ検証・正規化する。
		if (Object.hasOwn(options, 'resolution')) {
			if (options.resolution == null) throw new Error('Resolution must be specified');
			options.resolution = {
				width: Math.max(1, Math.floor(options.resolution.width)),
				height: Math.max(1, Math.floor(options.resolution.height)),
			};
		}
		if (Object.hasOwn(options, 'sceneId')) this.dynamicOptions.sceneId = options.sceneId;
		if (Object.hasOwn(options, 'previewFps')) this.dynamicOptions.previewFps = options.previewFps;
		if (Object.hasOwn(options, 'transformObserver')) this.dynamicOptions.transformObserver = options.transformObserver;
		// 起動前・初期化中の変更は、所有者が最新スナップショットで生成し直す。
		if (!this.isReady.value) return;
		return this.callAndWaitReturn('updateDynamicOptions', [options]);
	}

	public async applyProjectChanges(changes: readonly RendererProjectChange[]) {
		if (!this.isReady.value) return;
		await this.callAndWaitReturn('applyProjectChanges', [deepClone(changes), this.invalidateTransformPreview()]);
	}

	public renderTimelineAt(time: number, isManualSeek = false, seekMode: TimelinePreviewSeekMode = 'frame') {
		this.finishFrameCompletion(false);
		if (!this.isReady.value) return;
		// 既知のキャッシュなら完了通知を要求しない。未描画フレームから移動した場合も
		// 以前の待機状態を解除し、キャッシュされた画像の表示にスピナーを重ねない。
		if ((isManualSeek || this.pendingSeek.value != null) && this.hasCachedPreviewFrame(time, seekMode)) this.cancelSeek();
		else if (isManualSeek) this.pendingSeek.value = { requestId: ++this.seekRequestId, time };
		else if (this.pendingSeek.value != null && this.pendingSeek.value.time !== time) this.cancelSeek();
		// シーク中の編集・購読変更による同時刻の再描画にもIDを引き継ぐ。
		// 古い状態の完了はrevisionで除外し、新しい状態の描画が終わるまで表示を続ける。
		const requestId = this.pendingSeek.value?.requestId;
		this.call('renderTimelineAt', seekMode === 'precise' ? [time, requestId ?? null, seekMode] : requestId == null ? [time] : [time, requestId]);
	}

	/** BAKEはキャッシュ済みでもGPU描画の完了を待つ。通常シークのスピナーとは分けて管理する。 */
	public renderTimelineAtAndWait(time: number): Promise<boolean> {
		this.cancelSeek();
		if (!this.isReady.value || this.errorMessage.value != null) return Promise.resolve(false);
		return new Promise(resolve => {
			const requestId = ++this.seekRequestId;
			this.pendingFrameCompletion = { requestId, time, resolve };
			try {
				// RPCの戻り値は、既に描画中なら要求の登録だけで返る。requestId付きの
				// frameRenderedを使い、GPU完了前に次のフレームを送らないようにする。
				this.call('renderTimelineAt', [time, requestId]);
			} catch (error) {
				this.reportRenderFailure(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private finishFrameCompletion(completed: boolean) {
		const pending = this.pendingFrameCompletion;
		this.pendingFrameCompletion = null;
		pending?.resolve(completed);
	}

	private hasCachedPreviewFrame(time: number, seekMode: TimelinePreviewSeekMode): boolean {
		const cache = this.frameCacheState.value;
		const fps = this.dynamicOptions.previewFps ?? this.timelineFps;
		if (seekMode !== 'frame' || cache == null || cache.maxBytes <= 0 || cache.fps !== fps
			|| cache.sceneId !== (this.dynamicOptions.sceneId ?? null)) return false;
		const frameIndex = getTimelinePreviewFrameIndex(time, fps);
		// シークの待機表示も最後の通知に基づく。編集や容量変更後の反映の遅れを許容し、
		// 実際にテクスチャを再利用できるかどうかの最終判断はWorkerへ委ねる。
		return Math.abs(time - frameIndex * 1000 / fps) < 1e-7
			&& cache.frameRanges.some(range => range.startFrame <= frameIndex && frameIndex < range.endFrame);
	}

	public cancelSeek() {
		this.finishFrameCompletion(false);
		this.pendingSeek.value = null;
	}

	private invalidateTransformPreview() {
		// 設定・選択・編集の更新で完了通知の世代が変わる。旧要求を待ち続けずBAKEを中止する。
		this.finishFrameCompletion(false);
		this.layerTransform.value = null;
		return this.dynamicOptions.previewRevision = (this.dynamicOptions.previewRevision ?? 0) + 1;
	}

	public async observeLayerTransform(owner: object, sceneId: string | null, layerId: string | null) {
		// 複数のPreviewパネルが同じCanvasを使っても、一方の閉鎖で他方の購読を止めない。
		if (sceneId != null && layerId != null) this.transformObservers.set(owner, { sceneId, layerId });
		else this.transformObservers.delete(owner);
		const target = [...this.transformObservers.values()].at(-1);
		sceneId = target?.sceneId ?? null;
		layerId = target?.layerId ?? null;
		const previous = this.dynamicOptions.transformObserver;
		if ((previous?.sceneId ?? null) === sceneId && (previous?.layerId ?? null) === layerId) return;
		this.layerTransform.value = null;
		const transformObserver = sceneId != null && layerId != null ? { sceneId, layerId, requestId: ++this.transformRequestId } : null;
		await this.updateDynamicOptions({ transformObserver });
	}
}
