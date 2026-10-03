import { scaleResolution } from '@gs/shared/resolution.ts';
import { ref } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { createTimelineRendererManagerWorker } from '@gs/glitch-studio_renderer/client.ts';
import { RendererManagerControllerBase } from './RendererManagerControllerBase.ts';
import { TimelineEffectStateStore } from './utility/timeline-effect-status.ts';
import type { TimelineRendererManager, TimelineRendererManagerStaticOptions, TimelineRendererManagerDynamicOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import * as ui from '@/ui.ts';

export class TimelineRendererManagerController extends RendererManagerControllerBase<TimelineRendererManager> {
	public readonly canvasRevision = ref(0);
	public canvas: HTMLCanvasElement;
	public histogramCanvas: HTMLCanvasElement;
	public waveformHorizontalCanvas: HTMLCanvasElement;
	public waveformVerticalCanvas: HTMLCanvasElement;
	private staticOptions: TimelineRendererManagerStaticOptions;
	private dynamicOptions: Partial<TimelineRendererManagerDynamicOptions> & Pick<TimelineRendererManagerDynamicOptions, 'assets'> = {
		assets: [],
	};
	public errorMessage = ref<string | null>(null);
	private effectStates = new TimelineEffectStateStore();

	public getLayerEffectStates(sceneId: string, layerId: string): ReadonlyMap<string, EffectInstanceState> | undefined {
		return this.effectStates.getNodes(sceneId, layerId);
	}

	public getEffectLayerState(sceneId: string, layerId: string): EffectInstanceState | undefined {
		return this.effectStates.getLayer(sceneId, layerId);
	}

	constructor(staticOptions: TimelineRendererManagerStaticOptions, dynamicOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		super({
			getInitialOptions: async (isReload) => {
				if (isReload) {
					// 転送済みcanvasは再転送できない。属性を引き継ぎ、表示先への付け替えはUIに通知する。
					for (const key of ['canvas', 'histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const) {
						const previous = this[key];
						this[key] = previous.cloneNode(false) as HTMLCanvasElement;
					}
					this.canvasRevision.value++;
				}

				const offscreen = this.canvas.transferControlToOffscreen();
				const histogramOffscreen = this.histogramCanvas.transferControlToOffscreen();
				const waveformHorizontalOffscreen = this.waveformHorizontalCanvas.transferControlToOffscreen();
				const waveformVerticalOffscreen = this.waveformVerticalCanvas.transferControlToOffscreen();

				this.initialSnapshotTaken = true;
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
				if (error != null && !this.isReady.value) this.effectStates.clear();
			},
			eventHandlers: {
				effectState: (ctx) => {
					if (this.isReady.value) this.effectStates.updateNode(ctx.source, ctx.nodeId, ctx.status);
				},
				effectLayerState: (ctx) => {
					if (this.isReady.value) this.effectStates.updateLayer(ctx.source, ctx.status);
				},
				renderError: (ctx) => {
					// 描画できないグラフでも、修正するための更新は送り続ける。
					// 致命的なWorkerエラー後の遅延通知では、そのエラー表示を上書きしない。
					if (this.isReady.value) {
						this.errorMessage.value = ctx.message;
						if (ctx.message == null) this.effectStates.clearLayerErrors();
					}
				},
			},
			onCreated: () => {
			},
			onDisposed: () => {
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
		this.staticOptions = staticOptions;
		this.dynamicOptions = { ...this.dynamicOptions, ...dynamicOptions };
	}

	public async init(resolution: { width: number; height: number }, resolutionScale = 1) {
		const renderResolution = scaleResolution(resolution, resolutionScale);
		this.dynamicOptions.resolutionScale = resolutionScale;
		if (renderResolution.width > 8192 || renderResolution.height > 8192) {
			ui.alert({
				type: 'error',
				text: 'maximum supported resolution is 8192x8192',
			});
			throw new Error('maximum supported resolution is 8192x8192');
		}

		// 基準寸法と倍率を別々に保存し、計算用寸法の丸めは共通処理で行う。
		this.dynamicOptions.resolution = {
			width: Math.max(1, Math.floor(resolution.width)),
			height: Math.max(1, Math.floor(resolution.height)),
		};

		this.canvas.width = renderResolution.width;
		this.canvas.height = renderResolution.height;

		await this.launchManager(false);
	}

	public async updateDynamicOptions(newDynamicOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		const options = deepClone(newDynamicOptions);
		if (options.resolution !== undefined) {
			options.resolution = {
				width: Math.max(1, Math.floor(options.resolution.width)),
				height: Math.max(1, Math.floor(options.resolution.height)),
			};
		}
		this.dynamicOptions = { ...this.dynamicOptions, ...options };
		// 初回init前の設定は初期化メッセージに含める。初期化中はRPCのキューに積む。
		if (!this.isReady.value && !this.isInitializing) return { assetsCommitted: null };
		const result = await this.callAndWaitReturn('updateDynamicOptions', [options]);
		this.effectStates.clearLayerErrors();
		return result;
	}

	public async replaceProjectState(state: RendererProjectState) {
		const snapshot = deepClone(state);
		this.dynamicOptions = { ...this.dynamicOptions, ...snapshot,
			sceneId: snapshot.timelineScenes.some(scene => scene.id === this.dynamicOptions.sceneId) ? this.dynamicOptions.sceneId : null };
		if (!this.isReady.value && !this.isInitializing) return;
		if (!this.initialSnapshotTaken) return this.initializationReady;
		await this.callAndWaitReturn('replaceProjectState', [snapshot]);
		this.effectStates.clearLayerErrors();
	}

	public async applyProjectChanges(changes: readonly RendererProjectChange[]) {
		const patch = deepClone(changes);
		const next = applyRendererProjectChanges({ visualModules: this.dynamicOptions.visualModules ?? [], timelineScenes: this.dynamicOptions.timelineScenes ?? [] }, patch);
		this.dynamicOptions = { ...this.dynamicOptions, ...next,
			sceneId: next.timelineScenes.some(scene => scene.id === this.dynamicOptions.sceneId) ? this.dynamicOptions.sceneId : null };
		if (!this.isReady.value && !this.isInitializing) return;
		// 初期スナップショットへ取り込まれた差分は再送しない。削除済みノードへの
		// 更新を初期化後に再生すると失敗するため、送信境界以降だけをキューへ積む。
		if (!this.initialSnapshotTaken) return this.initializationReady;
		await this.callAndWaitReturn('applyProjectChanges', [patch]);
		this.effectStates.clearLayerErrors();
	}

	public updateStaticOptions(newStaticOptions: Partial<TimelineRendererManagerStaticOptions>): Promise<void> {
		this.staticOptions = { ...this.staticOptions, ...newStaticOptions };
		// 解放中は設定のみ保持する。Worker障害時は再生成して復旧できるようにする。
		if (!this.hasManager && !this.isInitializing) return Promise.resolve();
		return this.reload();
	}

	public renderTimelineAt(time: number, playback = false) {
		this.call('renderTimelineAt', [time, playback]);
	}

	public destroy() {
		super.destroy();
	}
}
