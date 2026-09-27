import { ref, shallowReactive } from 'vue';
import { createRendererWorker } from '@glitch/renderer/client.ts';
import { deepEqual } from '@glitch/shared/utility/deep-equal.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { projectAudioSourceId } from '@glitch/shared/audio.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { isVideoFrameAvailable, playVideoAfterFirstFrameIsReady } from './utility/video.ts';
import { LiveEffectStateStore } from './utility/live-effect-status.ts';
import { AudioInputs } from './audio/audio-inputs.ts';
import { setupWebcam } from './utility/webcam.ts';
import type { Player } from '@glitch/shared/types.ts';
import type { VisualModule, VisualModuleParameterBindings } from '@glitch/shared/visual-module/types.ts';
import type { MainRenderer, RendererDynamicOptions, RendererStaticOptions } from '@glitch/renderer/renderer.ts';
import type { EffectInstanceState, EffectStatusSource } from '@glitch/shared/effect/effect-status.ts';
import * as ui from '@/ui.ts';

type RendererMethods = {
	[K in keyof MainRenderer as MainRenderer[K] extends (...args: never[]) => unknown ? K : never]: MainRenderer[K];
};

export class RendererController {
	public canvas: HTMLCanvasElement;
	public histogramCanvas: HTMLCanvasElement;
	public waveformHorizontalCanvas: HTMLCanvasElement;
	public waveformVerticalCanvas: HTMLCanvasElement;
	private rendererWorker: Worker | null = null;
	private renderLoopRunning = false;
	// Worker再読み込みとエフェクト状態の参照に必要な内部情報。UIの再生状態はPreviewPlaybackControllerが所有する。
	private liveVisualModuleId = ref<VisualModule['id'] | null>(null);
	private liveParamValues: VisualModuleParameterBindings = {};
	private reloadPromise: Promise<void> | null = null;
	private rejectInitialization: ((reason: Error) => void) | null = null;
	private pendingCalls: { message: unknown; options?: StructuredSerializeOptions; onError?: (error: unknown) => void }[] = [];
	private pointerPosition = { x: 0, y: 0 };
	private rendererStaticOptions: RendererStaticOptions;
	private rendererDynamicOptions: Partial<RendererDynamicOptions> & Pick<RendererDynamicOptions, 'assets'> = {
		assets: [],
	};
	private players: Player[] = [];
	private videoElements = shallowReactive(new Map<Player['id'], HTMLMediaElement>());
	private playerAssetFiles = new Map<Player['id'], Blob>();
	private audioInputs = new AudioInputs(
		(id, port) => this.call('attachAudioSource', [id, port], [port]),
		(id, generation) => { if (this.isReady.value) this.call('resetAudioSource', [id, generation]); },
	);
	private videoLoads = new Map<Player['id'], Promise<void>>();
	private videoFrameCallbacks = new Map<Player['id'], number>();
	private pendingVideoFrames = new Map<Player['id'], VideoFrame>();
	private inFlightVideoFrames = new Map<Player['id'], number>();
	private nextVideoFrameId = 0;
	public gpuAverageDisplayFast = ref(0);
	public gpuAverageDisplayMedium = ref(0);
	public gpuAverageDisplaySlow = ref(0);
	public fpsDisplay = ref(0);
	public gpuMemoryUsage = ref<ReturnType<MainRenderer['gpuMemory']['getUsage']> | null>(null);
	public isReady = ref(false);
	public errorMessage = ref<string | null>(null);
	private liveEffectStateStore = new LiveEffectStateStore(shallowReactive(new Map<string, EffectInstanceState>()));

	public getLiveEffectState(visualModuleId: VisualModule['id'], nodeId: string): EffectInstanceState | undefined {
		if (this.liveVisualModuleId.value !== visualModuleId) return;
		return this.liveEffectStateStore.get(visualModuleId, nodeId);
	}

	constructor(rendererStaticOptions: RendererStaticOptions, rendererDynamicOptions: Partial<RendererDynamicOptions>) {
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
		this.rendererStaticOptions = rendererStaticOptions;
		this.rendererDynamicOptions = { ...this.rendererDynamicOptions, ...rendererDynamicOptions };
	}

	private call<FN extends keyof RendererMethods>(fn: FN, args: Parameters<RendererMethods[FN]>, options?: StructuredSerializeOptions | Transferable[]): void {
		//console.log('Calling renderer method:', fn, 'with args:', args);
		const message = { type: 'call', fn, args };
		const serializeOptions = Array.isArray(options) ? { transfer: options } : options;
		if (!this.isReady.value) {
			if (this.rendererWorker != null && this.rejectInitialization != null) {
				this.pendingCalls.push({ message, options: serializeOptions });
				return;
			}
			throw new Error('Renderer is not initialized');
		}
		if (this.rendererWorker != null) {
			this.rendererWorker.postMessage(message, serializeOptions);
		//} else if (this.renderer != null) {
		//	this.renderer[fn](...args);
		} else {
			throw new Error('Renderer is not initialized');
		}
	}

	private returnHooks = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
	private callCounter = 0;

	// 初期化チェックなどの同期的なthrowもPromiseのrejectに統一し、呼び出し側で.catch()でも受け取れるようasyncにする。
	private async callAndWaitReturn<FN extends keyof RendererMethods>(fn: FN, args: Parameters<RendererMethods[FN]>): Promise<Awaited<ReturnType<RendererMethods[FN]>>> {
		if (!this.isReady.value && this.rejectInitialization == null) {
			throw new Error('Renderer is not initialized');
		}
		if (this.rendererWorker != null) {
			return new Promise<Awaited<ReturnType<RendererMethods[FN]>>>((resolve, reject) => {
				const id = this.callCounter++;
				this.returnHooks.set(id, {
					resolve: value => resolve(value as Awaited<ReturnType<RendererMethods[FN]>>),
					reject,
				});
				const onError = (error: unknown) => {
					this.returnHooks.delete(id);
					reject(error);
				};
				try {
					const message = { type: 'call', fn, args, needReturnValue: true, id };
					// initメッセージ送信後の編集も、初期化完了時に送って応答まで待つ。
					if (!this.isReady.value) this.pendingCalls.push({ message, onError });
					else this.rendererWorker!.postMessage(message);
				} catch (error) {
					onError(error);
				}
			});
		} else {
			throw new Error('Renderer is not initialized');
		}
	}

	private rejectPendingReturns(error: Error) {
		// 終了したWorkerからは応答が来ないため、呼び出し側の待機も必ず解除する。
		for (const hook of this.returnHooks.values()) hook.reject(error);
		this.returnHooks.clear();
	}

	private sendPendingVideoFrame(playerId: string) {
		if (!this.isReady.value || !this.rendererWorker || this.inFlightVideoFrames.has(playerId)) return;
		const frame = this.pendingVideoFrames.get(playerId);
		if (!frame) return;
		this.pendingVideoFrames.delete(playerId);
		const id = this.nextVideoFrameId++;
		this.inFlightVideoFrames.set(playerId, id);
		try {
			this.rendererWorker.postMessage({ type: 'videoFrame', playerId, id, frame }, [frame]);
		} catch (error) {
			this.inFlightVideoFrames.delete(playerId);
			frame.close();
			throw error;
		}
	}

	public async init(resolution: { width: number; height: number }) {
		if (resolution.width > 8192 || resolution.height > 8192) {
			ui.alert({
				type: 'error',
				text: 'maximum supported resolution is 8192x8192',
			});
			throw new Error('maximum supported resolution is 8192x8192');
		}

		// Scaled preview dimensions can be fractional. Use the same integer pixel
		// dimensions for the canvas, textures, shader uniforms, and storage buffers.
		this.rendererDynamicOptions.resolution = {
			width: Math.max(1, Math.floor(resolution.width)),
			height: Math.max(1, Math.floor(resolution.height)),
		};

		this.canvas.width = this.rendererDynamicOptions.resolution.width;
		this.canvas.height = this.rendererDynamicOptions.resolution.height;

		const offscreen = this.canvas.transferControlToOffscreen();
		const histogramOffscreen = this.histogramCanvas.transferControlToOffscreen();
		const waveformHorizontalOffscreen = this.waveformHorizontalCanvas.transferControlToOffscreen();
		const waveformVerticalOffscreen = this.waveformVerticalCanvas.transferControlToOffscreen();

		const { promise: ready, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers<void>();
		this.rejectInitialization = rejectReady;

		this.rendererWorker = createRendererWorker();
		const worker = this.rendererWorker;
		worker.onerror = (event) => {
			if (this.rendererWorker !== worker) return;
			this.isReady.value = false;
			const error = new Error(event.message || 'Renderer worker failed');
			this.errorMessage.value = error.message;
			this.rejectPendingReturns(error);
			this.rejectInitialization?.(error);
			this.rejectInitialization = null;
			this.pendingCalls = [];
		};
		this.rendererWorker.postMessage({
			type: 'init',
			canvas: offscreen,
			histogramCanvas: histogramOffscreen,
			waveformHorizontalCanvas: waveformHorizontalOffscreen,
			waveformVerticalCanvas: waveformVerticalOffscreen,
			rendererStaticOptions: this.rendererStaticOptions,
			rendererDynamicOptions: this.rendererDynamicOptions,
		}, [offscreen, histogramOffscreen, waveformHorizontalOffscreen, waveformVerticalOffscreen]);
		this.rendererWorker.onmessage = (event) => {
			if (this.rendererWorker !== worker) return;
			switch (event.data?.type) {
				case 'initError': {
					this.isReady.value = false;
					this.errorMessage.value = event.data.message;
					const error = new Error(event.data.message);
					this.rejectPendingReturns(error);
					this.rejectInitialization?.(error);
					this.rejectInitialization = null;
					this.pendingCalls = [];
					break;
				}
				case 'inited': {
					this.isReady.value = true;
					this.errorMessage.value = null;
					this.rejectInitialization = null;
					for (const { message, options, onError } of this.pendingCalls) {
						try {
							worker.postMessage(message, options);
						} catch (error) {
							// 遅延送信の失敗でも待機中のRPCを完了させ、残りの更新は送信する。
							if (onError) onError(error);
							else this.errorMessage.value = error instanceof Error ? error.message : String(error);
						}
					}
					this.pendingCalls = [];
					for (const playerId of this.pendingVideoFrames.keys()) this.sendPendingVideoFrame(playerId);
					console.log('Renderer worker initialized!');
					resolveReady();
					break;
				}
				case 'previewError': {
					// 描画できないグラフでも、修正するための更新は送り続ける。
					// 致命的なWorkerエラー後の遅延通知では、そのエラー表示を上書きしない。
					if (this.isReady.value) this.errorMessage.value = event.data.message;
					break;
				}
				case 'return': {
					const { id, value, error, success } = event.data;
					const hook = this.returnHooks.get(id);
					if (hook != null) {
						this.returnHooks.delete(id);
						if (success) {
							hook.resolve(value);
						} else {
							const reason = new Error(error.message);
							reason.name = error.name;
							reason.stack = error.stack;
							hook.reject(reason);
						}
					}
					break;
				}
				case 'videoFrameReceived': {
					const { playerId, id } = event.data;
					if (this.inFlightVideoFrames.get(playerId) !== id) break;
					this.inFlightVideoFrames.delete(playerId);
					this.sendPendingVideoFrame(playerId);
					break;
				}
				case 'gpuMemory': {
					this.gpuMemoryUsage.value = event.data.usage;
					break;
				}
				case 'effectState': {
					const { source, nodeId, state } = event.data as { source: EffectStatusSource; nodeId: string; state: EffectInstanceState | null };
					this.liveEffectStateStore.update(source, nodeId, state);
					break;
				}
				case 'telemetry': {
					const { stats } = event.data;
					this.fpsDisplay.value = stats.fpsAverage;
					// テクスチャのコピーとか全ての処理が計測できているわけではなく、実際よりも少し小さい値になっていると思われるので、少し盛っておく
					this.gpuAverageDisplayFast.value = stats.gpuAverageFast * 1.2;
					this.gpuAverageDisplayMedium.value = stats.gpuAverageMedium * 1.2;
					this.gpuAverageDisplaySlow.value = stats.gpuAverageSlow * 1.2;
					break;
				}
				default: {
					console.warn('Unrecognized message from worker:', event.data?.type);
				}
			}
		};

		await ready;
	}

	public startLiveRenderLoopFor(visualModuleId: VisualModule['id'], paramValues: VisualModuleParameterBindings = {}) {
		this.liveParamValues = deepClone(paramValues);
		const statusInstanceId = genId();
		this.call('startLiveRenderLoopFor', [visualModuleId, this.liveParamValues, statusInstanceId]);
		this.liveEffectStateStore.start(visualModuleId, statusInstanceId);
		this.liveVisualModuleId.value = visualModuleId;
		this.renderLoopRunning = true;
	}

	public updateLiveParamValues(visualModuleId: VisualModule['id'], paramValues: VisualModuleParameterBindings) {
		if (!this.renderLoopRunning || this.liveVisualModuleId.value !== visualModuleId) {
			this.startLiveRenderLoopFor(visualModuleId, paramValues);
			return;
		}
		// 同じモジュールの操作ではインスタンスを維持し、履歴を初期化しない。
		this.liveParamValues = deepClone(paramValues);
		this.call('updateLiveParamValues', [this.liveParamValues]);
	}

	public stopRenderLoop() {
		this.call('stopRenderLoop', []);
		this.renderLoopRunning = false;
		this.liveEffectStateStore.stop();
		this.liveVisualModuleId.value = null;
	}

	public async updatePlayers(newPlayers: Player[]) {
		const oldPlayers = this.players;
		const players = deepClone(newPlayers);
		this.players = players;

		for (const [id, video] of this.videoElements) {
			const oldPlayer = oldPlayers.find(player => player.id === id);
			const newPlayer = players.find(player => player.id === id);
			const asset = newPlayer?.sourceType === 'asset' ? this.rendererDynamicOptions.assets.find(asset => asset.id === newPlayer.assetId) : null;
			if (!newPlayer || oldPlayer?.sourceType !== newPlayer.sourceType || !deepEqual(oldPlayer?.assetId, newPlayer.assetId)
				|| (newPlayer.sourceType === 'asset' && this.playerAssetFiles.get(id) !== asset?.fileData)) {
				this.audioInputs.removePlayer(id);
				const callbackId = this.videoFrameCallbacks.get(id);
				if (callbackId !== undefined && video instanceof HTMLVideoElement) video.cancelVideoFrameCallback(callbackId);
				this.videoFrameCallbacks.delete(id);
				this.pendingVideoFrames.get(id)?.close();
				this.pendingVideoFrames.delete(id);
				if (this.isReady.value) this.call('updateVideoFrame', [id, null]);
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
			if (!this.videoElements.has(player.id)) {
				const asset = player.sourceType === 'asset' ? this.rendererDynamicOptions.assets.find(asset => asset.id === player.assetId) : null;
				if (player.sourceType === 'asset' && !asset) continue;
				const video = window.document.createElement(asset?.fileDataType.startsWith('audio/') ? 'audio' : 'video');
				video.loop = true;
				video.preload = 'auto';
				video.volume = 1;
				this.videoElements.set(player.id, video);
				if (player.sourceType === 'asset') this.audioInputs.registerPlayer(player.id, video);
				this.videoLoads.set(player.id, new Promise<void>(resolve => {
					const finish = () => {
						video.removeEventListener('loadeddata', finish);
						video.removeEventListener('error', finish);
						video.removeEventListener('emptied', finish);
						if (video.error && this.videoElements.get(player.id) === video) {
							void ui.alert({ type: 'error', text: video.error.message });
						}
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
					video.src = URL.createObjectURL(asset!.fileData);
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

	public setPreviewVolume(volume: number) { this.audioInputs.setPreviewVolume(volume); }
	public get audioPreview() { return this.audioInputs.preview; }
	public retainAudioOutputCapture() { return this.audioInputs.retainOutputCapture(); }
	public get audioOutputLevels() { return this.audioInputs.getLevels(projectAudioSourceId); }

	public getPlayerLevels(playerId: Player['id']) { return this.audioInputs.getPlayerLevels(playerId); }

	public async updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.pointerPosition = { ...newPointerPosition };
		this.call('updatePointerPosition', [newPointerPosition]);
	}

	public renderTimelineAt(time: number) {
		if (this.isReady.value || (this.rendererWorker != null && this.rejectInitialization != null)) {
			this.call('renderTimelineAt', [time]);
			this.renderLoopRunning = false;
			this.liveEffectStateStore.stop();
			this.liveVisualModuleId.value = null;
		}
	}

	public async updateDynamicOptions(newDynamicOptions: Partial<RendererDynamicOptions>) {
		const options = deepClone(newDynamicOptions);
		if (options.resolution !== undefined) {
			options.resolution = {
				width: Math.max(1, Math.floor(options.resolution.width)),
				height: Math.max(1, Math.floor(options.resolution.height)),
			};
		}
		this.rendererDynamicOptions = { ...this.rendererDynamicOptions, ...options };
		// 初回init前の設定は初期化メッセージに含める。初期化中はRPCのキューに積む。
		if (this.rendererWorker == null) return { assetsCommitted: null };
		const result = await this.callAndWaitReturn('updateDynamicOptions', [options]);
		if (result.assetsCommitted && options.assets === this.rendererDynamicOptions.assets) {
			// 素材の差し替え・削除ではPlayer定義は変わらないため、ここで参照先を同期する。
			// 後続のAsset更新がある場合は、その完了側に同期を任せる。
			await this.updatePlayers(this.players);
		}
		return result;
	}

	public updateStaticOptions(newStaticOptions: Partial<RendererStaticOptions>): Promise<void> {
		this.rendererStaticOptions = { ...this.rendererStaticOptions, ...newStaticOptions };
		return this.reload();
	}

	public reload(): Promise<void> {
		if (this.reloadPromise) return this.reloadPromise;
		if (!this.rendererWorker || this.rejectInitialization != null) return Promise.reject(new Error('Renderer is not initialized'));
		this.reloadPromise = this.reloadRenderer().finally(() => { this.reloadPromise = null; });
		return this.reloadPromise;
	}

	private async reloadRenderer() {
		this.rejectPendingReturns(new Error('Engine reloaded during renderer call'));
		this.isReady.value = false;
		this.rendererWorker?.terminate();
		this.rendererWorker = null;
		this.inFlightVideoFrames.clear();
		for (const frame of this.pendingVideoFrames.values()) frame.close();
		this.pendingVideoFrames.clear();
		this.liveEffectStateStore.stop();
		this.gpuMemoryUsage.value = null;
		this.fpsDisplay.value = 0;
		this.gpuAverageDisplayFast.value = 0;
		this.gpuAverageDisplayMedium.value = 0;
		this.gpuAverageDisplaySlow.value = 0;

		// 転送済みcanvasは再転送できない。属性と表示先を保った新しい要素に置き換える。
		for (const key of ['canvas', 'histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const) {
			const previous = this[key];
			this[key] = previous.cloneNode(false) as HTMLCanvasElement;
			previous.replaceWith(this[key]);
		}

		const ready = this.init(this.rendererDynamicOptions.resolution!);
		const worker = this.rendererWorker;
		await ready;
		if (this.rendererWorker !== worker) throw new Error('Engine destroyed during reload');
		this.audioInputs.reconnectRenderer();
		// 一時停止中の動画には新しいフレーム通知が来ないため、現在のフレームも送り直す。
		for (const [id, media] of this.videoElements) {
			if (!(media instanceof HTMLVideoElement) || !isVideoFrameAvailable(media)) continue;
			this.pendingVideoFrames.get(id)?.close();
			this.pendingVideoFrames.set(id, new VideoFrame(media));
			this.sendPendingVideoFrame(id);
		}
		this.call('updatePointerPosition', [this.pointerPosition]);
		if (this.renderLoopRunning && this.liveVisualModuleId.value != null) this.startLiveRenderLoopFor(this.liveVisualModuleId.value, this.liveParamValues);
	}

	public destroy() {
		this.rejectPendingReturns(new Error('Engine destroyed during renderer call'));
		this.rejectInitialization?.(new Error('Engine destroyed during initialization'));
		this.rejectInitialization = null;
		this.pendingCalls = [];
		this.renderLoopRunning = false;
		this.liveVisualModuleId.value = null;
		this.liveEffectStateStore.stop();
		this.audioInputs.dispose();
		for (const [id, media] of this.videoElements) {
			const callback = this.videoFrameCallbacks.get(id);
			if (callback !== undefined && media instanceof HTMLVideoElement) media.cancelVideoFrameCallback(callback);
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
		this.rendererWorker?.terminate();
		this.rendererWorker = null;
		this.isReady.value = false;
	}
}
