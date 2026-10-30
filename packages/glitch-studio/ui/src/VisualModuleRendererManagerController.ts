import { ref, shallowReactive } from 'vue';
import { getFileSourceUrl, getFileSourceError } from '@gs/shared/file-source.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { createVisualModuleRendererManagerWorker } from '@gs/glitch-studio_renderer/client.ts';
import { isVideoFrameAvailable, playVideoAfterFirstFrameIsReady } from './utility/video.ts';
import { VisualModuleLivePreviewEffectStateStore } from './utility/visual-module-live-preview-effect-status.ts';
import { AudioInputs } from './audio/audio-inputs.ts';
import { setupWebcam } from './utility/webcam.ts';
import { RendererManagerControllerBase } from './RendererManagerControllerBase.ts';
import { displayCpuPreviewFrame } from './utility/cpu-preview-display.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { AudioOutput } from './audio/audio-output.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { VisualModuleArgumentBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { VisualModuleRendererManager, VisualModuleRendererManagerStaticOptions, VisualModuleRendererManagerDynamicOptions, VisualModuleRendererManagerEvents } from '@gs/glitch-studio_renderer/visual-module-renderer-manager.ts';

function isSamePlayerAssetFile(previous: FileSource | null | undefined, next: FileSource | null | undefined): boolean {
	if (previous === next) return true;
	if (previous == null || next == null || previous instanceof Blob || next instanceof Blob) return false;
	// URL入力は同期のdeepCloneで別オブジェクトになる。リロード時には新しいURLが
	// 発行されるため、URLと可用性で比較すれば無関係な編集で再生を止めずに済む。
	return previous.url === next.url && previous.error === next.error;
}

export class VisualModuleRendererManagerController extends RendererManagerControllerBase<VisualModuleRendererManager> {
	public onAssetReadFailure: (() => void) | null = null;
	public readonly canvasRevision = ref(0);
	public readonly outputResolution = ref<Resolution | null>(null);
	public canvas: HTMLCanvasElement;
	public histogramCanvas: HTMLCanvasElement;
	public waveformHorizontalCanvas: HTMLCanvasElement;
	public waveformVerticalCanvas: HTMLCanvasElement;
	private renderLoopRunning = false;
	// Worker再読み込みとエフェクト状態の参照に必要な内部情報。UIの再生状態はPreviewPlaybackControllerが所有する。
	private visualModuleLivePreviewVisualModuleId = ref<ProjectVisualModule['id'] | null>(null);
	private visualModuleLivePreviewParamValues: VisualModuleArgumentBindings = {};
	private pointerPosition = { x: 0, y: 0 };
	private staticOptions: VisualModuleRendererManagerStaticOptions;
	private initializationStaticOptions: VisualModuleRendererManagerStaticOptions | null = null;
	private dynamicOptions: Partial<VisualModuleRendererManagerDynamicOptions> = {};
	private initialAssets: readonly Asset[] = [];
	private players: Player[] = [];
	private videoElements = shallowReactive(new Map<Player['id'], HTMLMediaElement>());
	private playerAssetFiles = new Map<Player['id'], FileSource>();
	private audioInputs: AudioInputs;
	private videoLoads = new Map<Player['id'], Promise<void>>();
	private videoFrameCallbacks = new Map<Player['id'], number>();
	private pendingVideoFrames = new Map<Player['id'], VideoFrame>();
	private inFlightVideoFrames = new Map<Player['id'], number>();
	private nextVideoFrameId = 0;
	public gpuAverageDisplayFast = ref(0);
	public gpuAverageDisplayMedium = ref(0);
	public gpuAverageDisplaySlow = ref(0);
	public fpsDisplay = ref(0);
	public gpuMemoryUsage = ref<Parameters<VisualModuleRendererManagerEvents['gpuMemory']>[0]['usage'] | null>(null);
	public errorMessage = ref<string | null>(null);
	private visualModuleLivePreviewEffectStateStore = new VisualModuleLivePreviewEffectStateStore(shallowReactive(new Map<string, EffectInstanceState>()));

	public getVisualModuleLivePreviewEffectState(visualModuleId: ProjectVisualModule['id'], nodeId: string): EffectInstanceState | null {
		if (this.visualModuleLivePreviewVisualModuleId.value !== visualModuleId) return null;
		return this.visualModuleLivePreviewEffectStateStore.get(visualModuleId, nodeId) ?? null;
	}

	constructor(staticOptions: VisualModuleRendererManagerStaticOptions, dynamicOptions: Partial<VisualModuleRendererManagerDynamicOptions>, audioOutput: AudioOutput) {
		super({
			getInitialOptions: async () => {
				// 転送済みcanvasは再転送できないため、起動ごとに属性を引き継いだcanvasを用意する。
				// 初回も同じ手順に揃え、表示先への付け替えはUIに通知する。
				for (const key of ['canvas', 'histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const) {
					const previous = this[key];
					this[key] = previous.cloneNode(false) as HTMLCanvasElement;
				}
				this.canvasRevision.value++;

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
						resources: { assets: this.initialAssets, players: this.players },
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
				return createVisualModuleRendererManagerWorker();
			},
			onError: error => {
				this.errorMessage.value = error?.message ?? null;
			},
			eventHandlers: {
				cpuPreviewFrame: frame => {
					try { displayCpuPreviewFrame(this[frame.target], frame); } catch (error) { this.reportRenderFailure(error instanceof Error ? error : new Error(String(error))); } finally {
						if (this.isReady.value) this.call('recycleCpuPreviewPixels', [frame.target, frame.frameId, frame.pixels], [frame.pixels]);
					}
				},
				outputResolution: ctx => {
					this.outputResolution.value = ctx;
					// 転送済みcanvasのwidth属性は変更せず、表示枠だけをWorkerの実寸に合わせる。
					this.canvas.style.width = ctx.width + 'px';
					this.canvas.style.height = ctx.height + 'px';
				},
				gpuMemory: (ctx) => {
					this.gpuMemoryUsage.value = ctx.usage;
				},
				effectState: (ctx) => {
					if (ctx.status?.status.type === 'error') { this.reportRenderFailure(new Error(ctx.status.status.message), { source: ctx.source, nodeId: ctx.nodeId }); return; }
					const { source, nodeId, status } = ctx;
					this.visualModuleLivePreviewEffectStateStore.update(source, nodeId, status);
				},
				telemetry: (ctx) => {
					this.fpsDisplay.value = ctx.fpsAverage;
					// テクスチャのコピーとか全ての処理が計測できているわけではなく、実際よりも少し小さい値になっていると思われるので、少し盛っておく
					this.gpuAverageDisplayFast.value = ctx.gpuAverageFast * 1.2;
					this.gpuAverageDisplayMedium.value = ctx.gpuAverageMedium * 1.2;
					this.gpuAverageDisplaySlow.value = ctx.gpuAverageSlow * 1.2;
				},
				renderError: (ctx) => {
					this.reportRenderFailure(new Error(ctx.message));
				},
			},
			onCreated: () => {
				this.audioInputs.reconnectRenderer();
				// 一時停止中の動画には新しいフレーム通知が来ないため、現在のフレームも送り直す。
				for (const [id, media] of this.videoElements) {
					if (!(media instanceof HTMLVideoElement) || !isVideoFrameAvailable(media)) continue;
					this.pendingVideoFrames.get(id)?.close();
					this.pendingVideoFrames.set(id, new VideoFrame(media));
					this.sendPendingVideoFrame(id);
				}
				this.call('updatePointerPosition', [this.pointerPosition]);
				if (this.renderLoopRunning && this.visualModuleLivePreviewVisualModuleId.value != null) this.startVisualModuleLivePreviewRenderLoopFor(this.visualModuleLivePreviewVisualModuleId.value, this.visualModuleLivePreviewParamValues);
			},
			onDisposed: () => {
				this.outputResolution.value = null;
				this.inFlightVideoFrames.clear();
				for (const frame of this.pendingVideoFrames.values()) frame.close();
				this.pendingVideoFrames.clear();
				this.visualModuleLivePreviewEffectStateStore.stop();
				this.gpuMemoryUsage.value = null;
				this.fpsDisplay.value = 0;
				this.gpuAverageDisplayFast.value = 0;
				this.gpuAverageDisplayMedium.value = 0;
				this.gpuAverageDisplaySlow.value = 0;
			},
		});

		this.audioInputs = new AudioInputs(audioOutput,
			(id, port) => this.call('attachAudioSource', [id, port], [port]),
			(id, generation) => { if (this.isReady.value) this.call('resetAudioSource', [id, generation]); },
		);

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

	private async sendPendingVideoFrame(playerId: string) {
		if (!this.isReady.value || this.inFlightVideoFrames.has(playerId)) return;
		const frame = this.pendingVideoFrames.get(playerId);
		if (!frame) return;
		this.pendingVideoFrames.delete(playerId);
		const id = this.nextVideoFrameId++;
		this.inFlightVideoFrames.set(playerId, id);
		try {
			await this.callAndWaitReturn('updateVideoFrame', [playerId, frame], [frame]);
		} catch (error) {
			if (this.inFlightVideoFrames.get(playerId) === id) this.inFlightVideoFrames.delete(playerId);
			frame.close();
			throw error;
		}
		// Worker再読み込み前の応答で、新しい送信の状態を解除しない。
		if (this.inFlightVideoFrames.get(playerId) !== id) return;
		this.inFlightVideoFrames.delete(playerId);
		this.sendPendingVideoFrame(playerId);
	}

	public startVisualModuleLivePreviewRenderLoopFor(visualModuleId: ProjectVisualModule['id'], paramValues: VisualModuleArgumentBindings = {}) {
		this.outputResolution.value = null;
		this.visualModuleLivePreviewParamValues = deepClone(paramValues);
		const statusInstanceId = genId();
		// 再初期化中のモード変更はonCreatedで最新状態だけを復元し、古い開始要求をキューに残さない。
		if (this.isReady.value) this.call('startVisualModuleLivePreviewRenderLoopFor', [visualModuleId, this.visualModuleLivePreviewParamValues, statusInstanceId]);
		this.visualModuleLivePreviewEffectStateStore.start(visualModuleId, statusInstanceId);
		this.visualModuleLivePreviewVisualModuleId.value = visualModuleId;
		this.renderLoopRunning = true;
	}

	public updateVisualModuleLivePreviewParamValues(visualModuleId: ProjectVisualModule['id'], paramValues: VisualModuleArgumentBindings) {
		if (!this.renderLoopRunning || this.visualModuleLivePreviewVisualModuleId.value !== visualModuleId) {
			this.startVisualModuleLivePreviewRenderLoopFor(visualModuleId, paramValues);
			return;
		}
		// 同じモジュールの操作ではインスタンスを維持し、履歴を初期化しない。
		this.visualModuleLivePreviewParamValues = deepClone(paramValues);
		if (this.isReady.value) this.call('updateVisualModuleLivePreviewParamValues', [this.visualModuleLivePreviewParamValues]);
	}

	public stopRenderLoop() {
		if (this.isReady.value) this.call('stopRenderLoop', []);
		this.renderLoopRunning = false;
		this.outputResolution.value = null;
		this.visualModuleLivePreviewEffectStateStore.stop();
		this.visualModuleLivePreviewVisualModuleId.value = null;
	}

	public async updatePlayers(newPlayers: Player[]) {
		const oldPlayers = this.players;
		const players = deepClone(newPlayers);
		this.players = players;

		for (const [id, video] of this.videoElements) {
			const oldPlayer = oldPlayers.find(player => player.id === id);
			const newPlayer = players.find(player => player.id === id);
			const asset = newPlayer?.sourceType === 'asset' ? this.initialAssets.find(asset => asset.id === newPlayer.assetId) : null;
			if (!newPlayer || oldPlayer?.sourceType !== newPlayer.sourceType || !deepEqual(oldPlayer?.assetId, newPlayer.assetId)
				|| (newPlayer.sourceType === 'asset' && !isSamePlayerAssetFile(this.playerAssetFiles.get(id), asset?.fileData))) {
				this.audioInputs.removePlayer(id);
				const callbackId = this.videoFrameCallbacks.get(id);
				if (callbackId != null && video instanceof HTMLVideoElement) video.cancelVideoFrameCallback(callbackId);
				this.videoFrameCallbacks.delete(id);
				this.pendingVideoFrames.get(id)?.close();
				this.pendingVideoFrames.delete(id);
				video.pause();
				this.videoElements.delete(id);
				this.playerAssetFiles.delete(id);
				this.videoLoads.delete(id);
				if (video.srcObject instanceof MediaStream) {
					for (const track of video.srcObject.getTracks()) track.stop();
					video.srcObject = null;
				}
				URL.revokeObjectURL(video.src);
				video.removeAttribute('src');
				video.load();
			}
		}

		for (const player of players) {
			// 未割り当て・未対応の入力には読み込みイベントが発生しない。
			// Managerの再生成を待たせないよう、定義だけ保持してメディア要素は作らない。
			if (player.sourceType !== 'asset' && player.sourceType !== 'webcam') continue;
			if (!this.videoElements.has(player.id)) {
				const asset = player.sourceType === 'asset' ? this.initialAssets.find(asset => asset.id === player.assetId) : null;
				if (player.sourceType === 'asset' && !asset) continue;
				if (asset != null && getFileSourceError(asset.fileData) != null) continue;
				const video = window.document.createElement(asset?.fileDataType.startsWith('audio/') ? 'audio' : 'video');
				video.loop = true;
				video.preload = 'auto';
				video.crossOrigin = 'anonymous';
				video.volume = 1;
				this.videoElements.set(player.id, video);
				if (player.sourceType === 'asset') this.audioInputs.registerPlayer(player.id, video);
				// loadeddata後も、再生・シーク中に原本を読めなくなる場合がある。
				// 古い映像を残さずフレームを解除し、描画側では透明として継続する。
				video.addEventListener('error', () => {
					if (video.error == null || this.videoElements.get(player.id) !== video) return;
					this.pendingVideoFrames.get(player.id)?.close();
					this.pendingVideoFrames.delete(player.id);
					if (this.isReady.value) this.call('updateVideoFrame', [player.id, null]);
					this.onAssetReadFailure?.();
					console.error(video.error);
				});
				this.videoLoads.set(player.id, new Promise<void>(resolve => {
					const finish = () => {
						video.removeEventListener('loadeddata', finish);
						video.removeEventListener('error', finish);
						video.removeEventListener('emptied', finish);
						resolve();
					};
					video.addEventListener('loadeddata', finish);
					video.addEventListener('error', finish);
					video.addEventListener('emptied', finish);
				}));

				const onVideoFrame = () => {
					if (!(video instanceof HTMLVideoElement)) return;
					if (this.videoElements.get(player.id) !== video) return;
					try {
						if (!isVideoFrameAvailable(video)) return;
						const frame = new VideoFrame(video);
						// Retain only the newest frame while the worker is busy.
						this.pendingVideoFrames.get(player.id)?.close();
						this.pendingVideoFrames.set(player.id, frame);
						this.sendPendingVideoFrame(player.id);
					} finally {
						this.videoFrameCallbacks.set(player.id, video.requestVideoFrameCallback(onVideoFrame));
					}
				};

				if (video instanceof HTMLVideoElement) this.videoFrameCallbacks.set(player.id, video.requestVideoFrameCallback(onVideoFrame));

				if (player.sourceType === 'asset') {
					this.playerAssetFiles.set(player.id, asset!.fileData);
					video.src = getFileSourceUrl(asset!.fileData);
				} else if (player.sourceType === 'webcam' && video instanceof HTMLVideoElement) {
					this.videoLoads.set(player.id, setupWebcam().then(camera => {
						video.srcObject = camera;
						video.muted = true;
						video.playsInline = true;
						return playVideoAfterFirstFrameIsReady(video);
					}));
				}
			}
		}

		await Promise.all(this.videoLoads.values());
	}

	public getVideoElement(playerId: Player['id']): HTMLVideoElement | null {
		const media = this.videoElements.get(playerId);
		return media instanceof HTMLVideoElement ? media : null;
	}

	public getMediaElement(playerId: Player['id']): HTMLMediaElement | null {
		return this.videoElements.get(playerId) ?? null;
	}

	public async playPlayer(playerId: Player['id']) {
		if (this.players.find(player => player.id === playerId)?.sourceType === 'asset') await this.audioInputs.play(playerId);
		else await this.videoElements.get(playerId)?.play();
	}

	public getPlayerLevels(playerId: Player['id']) { return this.audioInputs.getPlayerLevels(playerId); }

	public async updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.pointerPosition = { ...newPointerPosition };
		if (this.isReady.value) this.call('updatePointerPosition', [newPointerPosition]);
	}

	public async updateDynamicOptions(newDynamicOptions: Partial<VisualModuleRendererManagerDynamicOptions>) {
		const options = deepClone(newDynamicOptions);
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
		if (!this.isReady.value && !this.isInitializing) return;
		await this.callAndWaitReturn('updateDynamicOptions', [options]);
	}

	/** 次に生成するManagerへ渡す。動作中のManagerの素材一覧は更新しない。 */
	public setInitialAssets(assets: readonly Asset[]) { this.initialAssets = deepClone(assets); }

	public async replaceProjectState(state: RendererProjectState) {
		const snapshot = { automationGraphs: deepClone(state.automationGraphs), visualModules: deepClone(state.visualModules), timelineScenes: [] };
		this.dynamicOptions = { ...this.dynamicOptions, automationGraphs: snapshot.automationGraphs, visualModules: snapshot.visualModules };
		if (!this.isReady.value && !this.isInitializing) return;
		if (!this.initialSnapshotTaken) return this.initializationReady;
		const replacement = this.callAndWaitReturn('replaceProjectState', [snapshot]);
		// 復旧用の再開も置換の直後に送る。応答待ちの後に送ると、その間の
		// パラメータ編集で再開を取りこぼしたり、モード切替後に古いVisual Module Live Previewを開始したりする。
		if (this.renderLoopRunning && this.visualModuleLivePreviewVisualModuleId.value != null) {
			this.startVisualModuleLivePreviewRenderLoopFor(this.visualModuleLivePreviewVisualModuleId.value, this.visualModuleLivePreviewParamValues);
		}
		await replacement;
	}

	public async applyProjectChanges(changes: readonly RendererProjectChange[]) {
		const patch = deepClone(changes.filter(change => change.type === 'automationGraphs' || change.type === 'visualModuleRegistration'
			|| (change.type === 'node' || change.type === 'visualModule') && 'visualModuleId' in change.target));
		if (patch.length === 0) return;
		const next = applyRendererProjectChanges({ automationGraphs: this.dynamicOptions.automationGraphs ?? [], visualModules: this.dynamicOptions.visualModules ?? [], timelineScenes: [] }, patch);
		this.dynamicOptions = { ...this.dynamicOptions, automationGraphs: next.automationGraphs, visualModules: next.visualModules };
		if (this.visualModuleLivePreviewVisualModuleId.value != null && !next.visualModules.some(visualModule => visualModule.id === this.visualModuleLivePreviewVisualModuleId.value)) this.stopRenderLoop();
		if (!this.isReady.value && !this.isInitializing) return;
		if (!this.initialSnapshotTaken) return this.initializationReady;
		await this.callAndWaitReturn('applyProjectChanges', [patch]);
	}

	public async updateStaticOptions(newStaticOptions: Partial<VisualModuleRendererManagerStaticOptions>): Promise<void> {
		this.staticOptions = { ...this.staticOptions, ...deepClone(newStaticOptions) };
		// 解放中は設定のみ保持する。Worker障害時は再生成して復旧できるようにする。
		if (!this.hasManager && !this.isInitializing) return;
		// 計測を連続で切り替えても、起動時の古い設定を残さず最新値まで反映する。
		if (this.isInitializing) await this.initializationReady;
		while (this.hasManager && !deepEqual(this.initializationStaticOptions, this.staticOptions)) {
			await this.reload();
		}
	}

	public destroy() {
		super.destroy();

		this.renderLoopRunning = false;
		this.visualModuleLivePreviewVisualModuleId.value = null;
		this.visualModuleLivePreviewEffectStateStore.stop();
		this.audioInputs.dispose();
		for (const [id, media] of this.videoElements) {
			const callback = this.videoFrameCallbacks.get(id);
			if (callback != null && media instanceof HTMLVideoElement) media.cancelVideoFrameCallback(callback);
			media.pause();
			if (media.srcObject instanceof MediaStream) {
				for (const track of media.srcObject.getTracks()) track.stop();
			}
			media.srcObject = null;
			URL.revokeObjectURL(media.src);
			media.removeAttribute('src');
			media.load();
		}
		for (const frame of this.pendingVideoFrames.values()) frame.close();
		this.videoElements.clear();
		this.playerAssetFiles.clear();
		this.videoFrameCallbacks.clear();
		this.videoLoads.clear();
		this.pendingVideoFrames.clear();
		this.inFlightVideoFrames.clear();
	}
}
