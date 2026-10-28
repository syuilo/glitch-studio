import { computed, ref, shallowRef } from 'vue';
import type { TimelineTransformPreview } from '@gs/glitch-studio_shared/timeline-transform-preview.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { createTimelineRendererManagerWorker } from '@gs/glitch-studio_renderer/client.ts';
import { RendererManagerControllerBase } from './RendererManagerControllerBase.ts';
import { TimelineEffectStateStore } from './utility/timeline-effect-status.ts';
import { displayCpuPreviewFrame } from './utility/cpu-preview-display.ts';
import type { TimelineRendererManager, TimelineRendererManagerStaticOptions, TimelineRendererManagerDynamicOptions, TimelinePreviewStatistics } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { TimelinePreviewFrameCacheState, TimelinePreviewSeekMode } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import { getTimelinePreviewFrameIndex } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';

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
	private staticOptions: TimelineRendererManagerStaticOptions;
	private initializationStaticOptions: TimelineRendererManagerStaticOptions | null = null;
	private dynamicOptions: Partial<TimelineRendererManagerDynamicOptions> & Pick<TimelineRendererManagerDynamicOptions, 'assets'> = {
		assets: [],
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

	constructor(staticOptions: TimelineRendererManagerStaticOptions, dynamicOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		super({
			getInitialOptions: async () => {
				// 転送済みcanvasは再転送できないため、起動ごとに属性を引き継いだcanvasを用意する。
				// 初回も同じ手順に揃え、表示先への付け替えはUIに通知する。
				for (const key of ['canvas', 'histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const) {
					const previous = this[key];
					this[key] = previous.cloneNode(false) as HTMLCanvasElement;
				}
				this.canvasRevision.value++;

				// CPU方式では実画面のCanvasをUIに残す。Workerには寸法を所有する描画先だけを渡す。
				const transferCanvas = (canvas: HTMLCanvasElement) => this.staticOptions.previewDisplayMode === 'cpu'
					? new OffscreenCanvas(canvas.width, canvas.height) : canvas.transferControlToOffscreen();
				const offscreen = transferCanvas(this.canvas);
				const histogramOffscreen = transferCanvas(this.histogramCanvas);
				const waveformHorizontalOffscreen = transferCanvas(this.waveformHorizontalCanvas);
				const waveformVerticalOffscreen = transferCanvas(this.waveformVerticalCanvas);

				this.initialSnapshotTaken = true;
				this.initializationStaticOptions = this.staticOptions;
				return {
					options: {
						canvas: offscreen,
						histogramCanvas: histogramOffscreen,
						waveformHorizontalCanvas: waveformHorizontalOffscreen,
						waveformVerticalCanvas: waveformVerticalOffscreen,
						staticOptions: this.staticOptions,
						dynamicOptions: this.dynamicOptions,
					},
					transfer: [
						offscreen,
						histogramOffscreen,
						waveformHorizontalOffscreen,
						waveformVerticalOffscreen,
					],
				};
			},
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
					if (this.isReady.value && ctx.sceneId === (this.dynamicOptions.sceneId ?? null)
						&& ctx.previewRevision === this.dynamicOptions.previewRevision) this.frameCacheState.value = ctx;
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
			onCreated: () => {
			},
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
		this.staticOptions = deepClone(staticOptions);
		this.dynamicOptions = { ...this.dynamicOptions, ...dynamicOptions };
		this.frameCacheMaxBytes.value = dynamicOptions.frameCacheMaxBytes ?? 0;
	}

	public async updateDynamicOptions(newDynamicOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		const options = deepClone(newDynamicOptions);
		if (options.frameCacheMaxBytes != null) this.frameCacheMaxBytes.value = options.frameCacheMaxBytes;
		if (['assets', 'resolution', 'resolutionScale', 'visualModules', 'timelineScenes', 'automationGraphs', 'sceneId', 'previewFps', 'generatedSpeech', 'frameCacheMaxBytes'].some(key => Object.hasOwn(options, key))) this.frameCacheState.value = null;
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
		this.dynamicOptions = { ...this.dynamicOptions, ...options };
		// 初回起動前の設定は初期化メッセージに含める。初期化中はRPCのキューに積む。
		if (!this.isReady.value && !this.isInitializing) return { assetsCommitted: null };
		return this.callAndWaitReturn('updateDynamicOptions', [options]);
	}

	public async replaceProjectState(state: RendererProjectState) {
		this.frameCacheState.value = null;
		this.cancelSeek();
		const snapshot = deepClone(state);
		const revision = this.invalidateTransformPreview();
		this.dynamicOptions = {
			...this.dynamicOptions,
			...snapshot,
			sceneId: snapshot.timelineScenes.some(scene => scene.id === this.dynamicOptions.sceneId) ? this.dynamicOptions.sceneId : null,
		};
		if (!this.isReady.value && !this.isInitializing) return;
		if (!this.initialSnapshotTaken) return this.initializationReady;
		await this.callAndWaitReturn('replaceProjectState', [snapshot, revision]);
	}

	public async applyProjectChanges(changes: readonly RendererProjectChange[]) {
		this.frameCacheState.value = null;
		const patch = deepClone(changes);
		const next = applyRendererProjectChanges({ automationGraphs: this.dynamicOptions.automationGraphs ?? [], visualModules: this.dynamicOptions.visualModules ?? [], timelineScenes: this.dynamicOptions.timelineScenes ?? [] }, patch);
		const revision = this.invalidateTransformPreview();
		this.dynamicOptions = {
			...this.dynamicOptions,
			...next,
			sceneId: next.timelineScenes.some(scene => scene.id === this.dynamicOptions.sceneId) ? this.dynamicOptions.sceneId : null,
		};
		if (!this.isReady.value && !this.isInitializing) return;
		// 初期スナップショットへ取り込まれた差分は再送しない。削除済みノードへの
		// 更新を初期化後に再生すると失敗するため、送信境界以降だけをキューへ積む。
		if (!this.initialSnapshotTaken) return this.initializationReady;
		await this.callAndWaitReturn('applyProjectChanges', [patch, revision]);
	}

	public async updateStaticOptions(newStaticOptions: Partial<TimelineRendererManagerStaticOptions>): Promise<void> {
		this.finishFrameCompletion(false);
		const options = { ...this.staticOptions, ...deepClone(newStaticOptions) };
		this.staticOptions = options;
		// 解放中は設定のみ保持する。Worker障害時は再生成して復旧できるようにする。
		if (!this.hasManager && !this.isInitializing) return;
		// 送信前の変更は初期スナップショットに含まれる。送信後の変更は初期化後に
		// 再生成して反映する。同値の適用や同時変更は、既存のreload待機を共有する。
		if (this.isInitializing) await this.initializationReady;
		while (this.hasManager && !deepEqual(this.initializationStaticOptions, this.staticOptions)) {
			await this.reload();
		}
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
		const fps = this.dynamicOptions.previewFps ?? this.staticOptions.timelineFps;
		if (seekMode !== 'frame' || cache == null || cache.maxBytes <= 0 || cache.fps !== fps
			|| cache.sceneId !== (this.dynamicOptions.sceneId ?? null)) return false;
		const frameIndex = getTimelinePreviewFrameIndex(time, fps);
		// 選択・表示設定だけでもpreviewRevisionは進むが、画像は引き続き利用できる。
		// 内容や容量の変更時にはframeCacheState自体を消して、次の通知まで未確認とする。
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

	public destroy() {
		super.destroy();
	}
}
