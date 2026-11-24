import { computed, ref, shallowRef } from 'vue';
import { getFileSourceUrl, getFileSourceError, releaseFileSourceUrl } from '@gs/shared/file-source.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { createEffectLivePreviewManagerWorker } from '@gs/glitch-studio_renderer/client.ts';
import { isEffectLivePreviewProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { isVideoFrameAvailable } from './utility/video.ts';
import { i18n } from './i18n.ts';
import { RendererManagerControllerBase } from './RendererManagerControllerBase.ts';
import { displayCpuPreviewFrame } from './utility/cpu-preview-display.ts';
import { openPreviewDevice, previewDeviceConstraint } from './utility/preview-device.ts';
import type { PreviewImageAnalysisSettings, PreviewImageAnalysisDisplaySettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import type { AudioOutput } from './audio/audio-output.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { EffectLivePreviewSource, EffectLivePreviewParamValues } from './types/effect-live-preview.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectPreparationStatus } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { EffectRenderTilingProgress } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type { EffectLivePreviewManager, EffectLivePreviewManagerResources, EffectLivePreviewManagerStaticOptions, EffectLivePreviewManagerDynamicOptions, EffectLivePreviewManagerEvents } from '@gs/glitch-studio_renderer/effect-live-preview-manager.ts';

export type EffectLivePreviewManagerInitialOptions = {
	staticOptions: EffectLivePreviewManagerStaticOptions;
	dynamicOptions: Partial<EffectLivePreviewManagerDynamicOptions>;
	resources: EffectLivePreviewManagerResources;
};

export class EffectLivePreviewManagerController extends RendererManagerControllerBase<EffectLivePreviewManager> {
	public onAssetReadFailure: (() => void) | null = null;
	public readonly canvasRevision = ref(0);
	public readonly outputResolution = ref<Resolution | null>(null);
	public readonly isRenderDelayed = ref(false);
	public readonly renderTilingProgress = shallowRef<EffectRenderTilingProgress | null>(null);
	public canvas: HTMLCanvasElement;
	public histogramCanvas: HTMLCanvasElement;
	public waveformHorizontalCanvas: HTMLCanvasElement;
	public waveformVerticalCanvas: HTMLCanvasElement;
	// Worker再読み込みとエフェクト状態の参照に必要な内部情報。UIの再生状態はPreviewPlaybackControllerが所有する。
	private effectLivePreviewStatusInstanceId: string | null = null;
	private pointerPosition = { x: 0, y: 0 };
	public readonly previewMediaElement = shallowRef<HTMLMediaElement | null>(null);
	public readonly previewMediaError = ref<string | null>(null);
	public readonly previewDeviceRevision = ref(0);
	private releaseMedia: (() => void) | null = null;
	private liveCapture: AbortController | null = null;
	private readonly livePreviewAudioMonitoring = shallowRef<ReturnType<AudioOutput['connectLivePreviewAudio']> | null>(null);
	public readonly livePreviewAudioMonitoringAvailable = computed(() => this.livePreviewAudioMonitoring.value != null);
	public readonly livePreviewAudioMonitoringEnabled = ref(false);
	private mediaAudioNode: MediaElementAudioSourceNode | null = null;
	private pendingVideoFrame: VideoFrame | null = null;
	private inFlightVideoFrame: number | null = null;
	private nextVideoFrameId = 0;
	public gpuAverageDisplayFast = ref(0);
	public gpuAverageDisplayMedium = ref(0);
	public gpuAverageDisplaySlow = ref(0);
	public fpsDisplay = ref(0);
	public gpuMemoryUsage = ref<Parameters<EffectLivePreviewManagerEvents['gpuMemory']>[0]['usage'] | null>(null);
	public errorMessage = ref<string | null>(null);
	public readonly preparationStatus = shallowRef<EffectPreparationStatus | null>(null);

	constructor(private readonly audioOutput: AudioOutput) {
		super({
			createWorker: () => {
				return createEffectLivePreviewManagerWorker();
			},
			onError: error => {
				this.errorMessage.value = error?.message ?? null;
				if (error != null) {
					this.isRenderDelayed.value = false;
					this.renderTilingProgress.value = null;
				}
			},
			eventHandlers: {
				renderDelay: ctx => {
					if (ctx.instanceId !== this.effectLivePreviewStatusInstanceId) return;
					this.isRenderDelayed.value = ctx.isDelayed;
					this.renderTilingProgress.value = ctx.tilingProgress;
				},
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
					if (ctx.source.instanceId !== this.effectLivePreviewStatusInstanceId) return;
					this.preparationStatus.value = ctx.status;
					if (ctx.status?.type === 'error') this.reportRenderFailure(new Error(String(ctx.status.error)), { source: ctx.source });
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
				this.call('updatePointerPosition', [this.pointerPosition]);
			},
			onDisposed: () => {
				this.preparationStatus.value = null;
				this.outputResolution.value = null;
				this.isRenderDelayed.value = false;
				this.renderTilingProgress.value = null;
				this.effectLivePreviewStatusInstanceId = null;
				this.releasePreviewMedia();
				this.gpuMemoryUsage.value = null;
				this.fpsDisplay.value = 0;
				this.gpuAverageDisplayFast.value = 0;
				this.gpuAverageDisplayMedium.value = 0;
				this.gpuAverageDisplaySlow.value = 0;
			},
		});

		this.canvas = window.document.createElement('canvas');
		this.canvas.style.display = 'block';
		this.canvas.style.imageRendering = 'pixelated';
		this.histogramCanvas = window.document.createElement('canvas');
		this.histogramCanvas.width = 256;
		this.histogramCanvas.height = 150;
		this.histogramCanvas.style.display = 'block';
		this.histogramCanvas.style.width = '100%';
		this.histogramCanvas.style.height = '100%';
		this.waveformHorizontalCanvas = window.document.createElement('canvas');
		this.waveformHorizontalCanvas.width = 1;
		this.waveformHorizontalCanvas.height = 1;
		this.waveformHorizontalCanvas.style.display = 'block';
		this.waveformHorizontalCanvas.style.width = '100%';
		this.waveformHorizontalCanvas.style.height = '100%';
		this.waveformVerticalCanvas = window.document.createElement('canvas');
		this.waveformVerticalCanvas.width = 1;
		this.waveformVerticalCanvas.height = 1;
		this.waveformVerticalCanvas.style.display = 'block';
		this.waveformVerticalCanvas.style.width = '100%';
		this.waveformVerticalCanvas.style.height = '100%';
	}

	/** 起動ごとに所有者が取得した最新スナップショットだけを使い、停止中の編集状態を複製しない。 */
	public async initialize(options: EffectLivePreviewManagerInitialOptions): Promise<void> {
		const snapshot = deepClone(options);
		await this.launchManager(() => {
			// 転送済みcanvasは再転送できないため、起動ごとに属性を引き継いだcanvasを用意する。
			// 初回も同じ手順に揃え、表示先への付け替えはUIに通知する。
			for (const key of ['canvas', 'histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const) {
				const previous = this[key];
				this[key] = previous.cloneNode(false) as HTMLCanvasElement;
			}
			this.canvasRevision.value++;

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
	}

	private async sendPendingVideoFrame() {
		if (!this.isReady.value || this.inFlightVideoFrame != null || this.pendingVideoFrame == null) return;
		const frame = this.pendingVideoFrame;
		this.pendingVideoFrame = null;
		const id = this.nextVideoFrameId++;
		this.inFlightVideoFrame = id;
		try {
			await this.callAndWaitReturn('updatePreviewImage', [{ kind: 'frame', frame }], [frame]);
		} catch (error) {
			frame.close();
			if (this.inFlightVideoFrame !== id) return;
			this.inFlightVideoFrame = null;
			this.reportRenderFailure(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		// 破棄済みWorkerからの応答は、新しいWorkerの送信を解除しない。
		if (this.inFlightVideoFrame !== id) return;
		this.inFlightVideoFrame = null;
		void this.sendPendingVideoFrame();
	}

	public startEffectLivePreviewRenderLoop(effectSource: EffectLivePreviewSource, paramValues: EffectLivePreviewParamValues = {}) {
		this.preparationStatus.value = null;
		this.outputResolution.value = null;
		const statusInstanceId = genId();
		this.effectLivePreviewStatusInstanceId = statusInstanceId;
		this.isRenderDelayed.value = false;
		this.renderTilingProgress.value = null;
		// 再生成中の表示モードはPreviewPlaybackControllerが保持し、両プレビューの準備後に再開する。
		if (this.isReady.value) this.call('startEffectLivePreview', [{ effectSource, params: deepClone(paramValues) }, statusInstanceId]);
	}

	public updateEffectLivePreviewParamValues(paramValues: EffectLivePreviewParamValues) {
		if (this.isReady.value) this.call('updateEffectLivePreviewParamValues', [deepClone(paramValues)]);
	}

	public resetRenderHistory() {
		if (this.isReady.value) this.call('resetRenderHistory', []);
	}

	public stopRenderLoop() {
		this.effectLivePreviewStatusInstanceId = null;
		this.isRenderDelayed.value = false;
		this.renderTilingProgress.value = null;
		if (this.isReady.value) this.call('stopRenderLoop', []);
		this.preparationStatus.value = null;
		this.outputResolution.value = null;
	}

	public setPreviewInput(source: { kind: 'asset'; asset: Asset } | { kind: 'webcam'; deviceId: string; captureAudio: boolean } | { kind: 'microphone'; deviceId: string } | null) {
		this.releasePreviewMedia();
		if (!this.isReady.value) return;
		const asset = source?.kind === 'asset' ? source.asset : null;
		const mimeType = asset?.fileDataType ?? '';
		const isImage = mimeType.startsWith('image/');
		const isAudio = mimeType.startsWith('audio/');
		const isVideo = mimeType.startsWith('video/');
		const fileError = asset == null ? null : getFileSourceError(asset.fileData);
		this.call('updatePreviewImage', [asset != null && isImage && fileError == null ? { kind: 'asset', assetId: asset.id } : null]);
		this.call('setPreviewAudioSource', [asset != null && fileError == null && (isAudio || isVideo) ? asset.id : null]);
		if (fileError != null) {
			this.previewMediaError.value = fileError;
			return;
		}
		if (source?.kind === 'microphone') {
			this.startLiveCapture(source.deviceId, null, false);
			return;
		}
		if (!isAudio && !isVideo && source?.kind !== 'webcam') return;

		const media = window.document.createElement(isAudio ? 'audio' : 'video');
		const video = media instanceof HTMLVideoElement ? media : null;
		const url = asset == null ? null : getFileSourceUrl(asset.fileData);
		media.preload = 'auto';
		media.crossOrigin = 'anonymous';
		this.previewMediaElement.value = media;
		let frameCallback: number | null = null;
		let audioPositionCallback: number | null = null;
		const current = () => this.previewMediaElement.value === media;
		const sendFrame = () => {
			if (!current() || video == null || !isVideoFrameAvailable(video) || video.seeking) return;
			this.pendingVideoFrame?.close();
			this.pendingVideoFrame = new VideoFrame(video);
			void this.sendPendingVideoFrame();
		};
		const onVideoFrame = () => {
			if (!current() || video == null) return;
			frameCallback = video.requestVideoFrameCallback(onVideoFrame);
			sendFrame();
		};
		if (video != null) {
			video.playsInline = true;
			frameCallback = video.requestVideoFrameCallback(onVideoFrame);
			video.addEventListener('loadeddata', sendFrame);
			video.addEventListener('seeked', sendFrame);
		}

		const updatePosition = (discontinuity = false) => {
			if (current() && this.isReady.value && asset != null && Number.isFinite(media.currentTime)) {
				this.call('updatePreviewAudioPosition', [media.currentTime, discontinuity]);
			}
		};
		const followPlayback = () => {
			if (audioPositionCallback != null) window.cancelAnimationFrame(audioPositionCallback);
			updatePosition();
			audioPositionCallback = media.paused || media.ended || !current() ? null : window.requestAnimationFrame(followPlayback);
		};
		const onSeek = () => updatePosition(true);
		if (asset != null) {
			for (const event of ['play', 'pause', 'ended', 'seeked', 'loadeddata'] as const) media.addEventListener(event, followPlayback);
			media.addEventListener('seeking', onSeek);
		}
		const onMediaError = (error: unknown) => {
			if (!current()) return;
			if (source?.kind === 'webcam') this.releasePreviewMedia();
			this.pendingVideoFrame?.close();
			this.pendingVideoFrame = null;
			if (this.isReady.value) {
				this.call('updatePreviewImage', [null]);
				this.call('setPreviewAudioSource', [null]);
			}
			this.previewMediaError.value = error instanceof Error ? error.message : String(error);
			if (asset != null) this.onAssetReadFailure?.();
		};
		media.addEventListener('error', () => onMediaError(media.error?.message ?? 'Unable to load preview media.'));
		this.releaseMedia = () => {
			if (frameCallback != null) video?.cancelVideoFrameCallback(frameCallback);
			if (audioPositionCallback != null) window.cancelAnimationFrame(audioPositionCallback);
			media.pause();
			media.srcObject = null;
			media.removeAttribute('src');
			media.load();
			if (asset != null && url != null) releaseFileSourceUrl(asset.fileData, url);
		};
		if (url != null) {
			media.src = url;
		} else if (source?.kind === 'webcam' && video != null) this.startLiveCapture(source.deviceId, video, source.captureAudio);
	}

	private startLiveCapture(deviceId: string, video: HTMLVideoElement | null, captureWebcamAudio: boolean) {
		const lifetime = new AbortController();
		this.liveCapture = lifetime;
		void this.openLiveCapture(deviceId, video, captureWebcamAudio, lifetime.signal).catch(error => {
			if (!lifetime.signal.aborted) this.failLiveCapture(error instanceof Error ? error.message : String(error));
		});
	}

	private failLiveCapture(message: string) {
		this.releasePreviewMedia();
		this.call('updatePreviewImage', [null]);
		this.call('setPreviewAudioSource', [null]);
		this.previewMediaError.value = message;
	}

	private async openLiveCapture(deviceId: string, video: HTMLVideoElement | null, captureWebcamAudio: boolean, signal: AbortSignal) {
		const device = previewDeviceConstraint(deviceId);
		const constraints = video == null ? { video: false, audio: device } : { video: device, audio: false };
		const stream = await openPreviewDevice(constraints, signal);
		if (stream == null || signal.aborted) return;
		this.previewDeviceRevision.value++;
		if (video == null) {
			await this.attachLiveAudio(stream, signal);
			return;
		}

		const [videoTrack] = stream.getVideoTracks();
		videoTrack.addEventListener('ended', () => this.failLiveCapture(i18n.ts._EffectPreview.DeviceUnavailable), { once: true, signal });
		video.muted = true;
		video.srcObject = stream;
		await video.play();
		if (!captureWebcamAudio || signal.aborted) return;

		// カメラと同じ機器の音声だけを取得する。許可待ちや音声エラーの間も映像を表示する。
		const groupId = videoTrack.getSettings().groupId;
		const audioLifetime = new AbortController();
		try {
			if (groupId != null && groupId !== '') {
				const audioSignal = AbortSignal.any([signal, audioLifetime.signal]);
				const audioStream = await openPreviewDevice({ video: false, audio: { groupId: { exact: groupId } } }, audioSignal);
				if (audioSignal.aborted || audioStream == null) return;
				this.previewDeviceRevision.value++;
				if (audioStream.getAudioTracks()[0]?.getSettings().groupId === groupId) {
					await this.attachLiveAudio(audioStream, audioSignal);
					return;
				}
			}
		} catch {
			// 音声デバイスが無い場合や許可されない場合も、カメラの映像を利用できる。
		}
		audioLifetime.abort();
		if (!signal.aborted) this.previewMediaError.value = i18n.ts._EffectPreview.WebcamAudioUnavailable;
	}

	private async attachLiveAudio(stream: MediaStream, signal: AbortSignal) {
		const audioTracks = stream.getAudioTracks();
		if (signal.aborted || audioTracks.length === 0) return;

		const output = await this.audioOutput.getOutput();
		if (signal.aborted) return;
		const source = (output.context as AudioContext).createMediaStreamSource(stream);
		// プレビュー入力パラメータには、他の再生音が混ざる前のPCMを渡す。
		const capture = this.audioOutput.captureSource(source, {
			meterId: 'preview:input',
			pcm: {
				attach: port => this.call('attachPreviewAudioCapture', [port], [port]),
				reset: () => { if (!signal.aborted && this.isReady.value) this.call('setPreviewAudioSource', [null]); },
			},
		});
		const releaseAudio = () => {
			signal.removeEventListener('abort', releaseAudio);
			for (const track of audioTracks) track.removeEventListener('ended', onAudioEnded);
			this.livePreviewAudioMonitoring.value?.dispose();
			this.livePreviewAudioMonitoring.value = null;
			this.livePreviewAudioMonitoringEnabled.value = false;
			capture.dispose();
		};
		const onAudioEnded = () => {
			if (audioTracks.every(track => track.readyState === 'ended')) releaseAudio();
		};
		signal.addEventListener('abort', releaseAudio, { once: true });
		for (const track of audioTracks) track.addEventListener('ended', onAudioEnded);
		try {
			this.livePreviewAudioMonitoring.value = this.audioOutput.connectLivePreviewAudio(source);
			capture.setState(true, 0);
		} catch (error) {
			releaseAudio();
			throw error;
		}
		onAudioEnded();
	}

	public setLivePreviewAudioMonitoringEnabled(enabled: boolean) {
		const monitoring = this.livePreviewAudioMonitoring.value;
		if (monitoring == null) return;
		monitoring.setEnabled(enabled);
		this.livePreviewAudioMonitoringEnabled.value = enabled;
	}

	public async playPreviewMedia() {
		const media = this.previewMediaElement.value;
		if (media == null) return;
		const output = await this.audioOutput.getOutput();
		if (this.previewMediaElement.value !== media) return;
		// 試聴音もプロジェクトの音量・モニターを通す。EffectへのPCMは素材時刻から別途読み取る。
		if (this.mediaAudioNode == null) {
			this.mediaAudioNode = (output.context as AudioContext).createMediaElementSource(media);
			this.mediaAudioNode.connect(output);
		}
		await media.play();
	}

	public async updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.pointerPosition = { ...newPointerPosition };
		if (this.isReady.value) this.call('updatePointerPosition', [newPointerPosition]);
	}

	public async updateDynamicOptions(newDynamicOptions: Partial<EffectLivePreviewManagerDynamicOptions>) {
		const options = deepClone(newDynamicOptions);
		// Partialのresolution省略は変更なし。指定された場合だけ検証・正規化する。
		if (Object.hasOwn(options, 'resolution')) {
			if (options.resolution == null) throw new Error('Resolution must be specified');
			options.resolution = {
				width: Math.max(1, Math.floor(options.resolution.width)),
				height: Math.max(1, Math.floor(options.resolution.height)),
			};
		}
		// 起動前・初期化中の変更は、所有者が最新スナップショットで生成し直す。
		if (!this.isReady.value) return;
		await this.callAndWaitReturn('updateDynamicOptions', [options]);
	}

	public async setHighResolutionImageAnalysis(enabled: boolean, settings: PreviewImageAnalysisSettings): Promise<boolean> {
		if (!this.isReady.value) return false;
		return this.callAndWaitReturn('setHighResolutionImageAnalysis', [enabled, deepClone(settings)]);
	}

	public capturePreview(maximumSize: number) {
		return this.callAndWaitReturn('capturePreview', [maximumSize]);
	}

	public async setImageAnalysisDisplay(settings: PreviewImageAnalysisDisplaySettings, refresh: boolean): Promise<void> {
		if (!this.isReady.value) return;
		await this.callAndWaitReturn('setImageAnalysisDisplay', [deepClone(settings), refresh]);
	}

	public async applyProjectChanges(changes: readonly RendererProjectChange[]) {
		if (!this.isReady.value) return;
		const patch = changes.filter(isEffectLivePreviewProjectChange);
		if (patch.length > 0) await this.callAndWaitReturn('applyProjectChanges', [deepClone(patch)]);
	}

	private releasePreviewMedia() {
		this.previewMediaElement.value = null;
		this.previewMediaError.value = null;
		this.mediaAudioNode?.disconnect();
		this.mediaAudioNode = null;
		this.liveCapture?.abort();
		this.liveCapture = null;
		this.releaseMedia?.();
		this.releaseMedia = null;
		this.pendingVideoFrame?.close();
		this.pendingVideoFrame = null;
		this.inFlightVideoFrame = null;
	}
}
