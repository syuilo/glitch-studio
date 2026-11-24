import { computed, ref, shallowRef } from 'vue';
import { getFileSourceUrl, releaseFileSourceUrl } from '@gs/shared/file-source.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { MediaPlayerRendererOptions } from '@gs/glitch-studio_renderer/media-player-renderer.ts';
import type { AudioOutput } from './audio/audio-output.ts';
import { i18n } from './i18n.ts';
import { MediaPlayerRendererController } from './MediaPlayerRendererController.ts';
import { openPreviewDevice, previewDeviceConstraint } from './utility/preview-device.ts';
import { isVideoFrameAvailable } from './utility/video.ts';

export type MediaPlayerSelection =
	| { kind: 'asset'; assetId: string | null }
	| { kind: 'webcam' | 'microphone'; deviceId: string | null };

const audioCaptureConstraints = { echoCancellation: false, autoGainControl: false, noiseSuppression: false };

export class MediaPlayerController {
	public readonly selection = shallowRef<MediaPlayerSelection>({ kind: 'asset', assetId: null });
	public readonly selectedAsset = computed(() => {
		const selection = this.selection.value;
		return selection.kind === 'asset' && selection.assetId != null ? this.findAsset(selection.assetId) ?? null : null;
	});
	public readonly mediaElement = shallowRef<HTMLMediaElement | null>(null);
	public readonly currentTime = ref(0);
	public readonly active = ref(false);
	public readonly captureStatus = ref<'idle' | 'connecting' | 'live'>('idle');
	public readonly captureWebcamAudio = ref(false);
	public readonly deviceRevision = ref(0);
	public readonly audioCaptureSettings = shallowRef<MediaTrackSettings | null>(null);
	public readonly monitoringAvailable = ref(false);
	public readonly monitoringEnabled = ref(false);
	public readonly errorMessage = ref<string | null>(null);
	public readonly renderer = new MediaPlayerRendererController();
	private lifetime: AbortController | null = null;
	private video: HTMLVideoElement | null = null;
	private image: FileSource | null = null;
	private assetFile: FileSource | null = null;
	private lastAssetPosition: { assetId: string; seconds: number } | null = null;
	private audioConnection: ReturnType<AudioOutput['connectLivePreviewAudio']> | null = null;
	private fileAudioConnection: Promise<void> | null = null;
	private rendererRequest = 0;

	constructor(
		private readonly audioOutput: AudioOutput,
		private readonly findAsset: (id: string) => Asset | undefined,
		private readonly rendererOptions: () => Omit<MediaPlayerRendererOptions, 'canvases'>,
		private readonly onAssetReadFailure: () => void,
	) {}

	public syncSource(active: boolean) {
		const changedActivity = this.active.value !== active;
		this.active.value = active;
		if (!active) {
			this.releaseSource();
			return;
		}
		const asset = this.selectedAsset.value;
		const assetFile = asset?.fileData ?? null;
		if (!changedActivity && assetFile === this.assetFile) return;
		this.releaseSource();
		this.assetFile = assetFile;
		if (asset != null) this.openAsset(asset);
		else if (this.selection.value.kind === 'asset' && this.selection.value.assetId != null) {
			this.errorMessage.value = i18n.ts._MediaPlayer.AssetUnavailable;
		}
	}

	public setSelection(selection: MediaPlayerSelection) {
		this.releaseSource();
		this.selection.value = selection;
		this.syncSource(this.active.value);
	}

	public async restartRenderer() {
		const request = ++this.rendererRequest;
		this.renderer.stop();
		if (this.image == null && this.video == null) return;
		const image = this.image;
		try {
			await this.renderer.start(this.rendererOptions());
			if (request !== this.rendererRequest) return;
			await this.renderer.updateOptions(this.rendererOptions().preview);
			if (request !== this.rendererRequest) return;
			if (image != null) await this.renderer.showImage(image);
			else this.sendVideoFrame();
		} catch (error) {
			if (request !== this.rendererRequest) return;
			if (this.renderer.errorMessage.value == null) this.renderer.errorMessage.value = this.describeError(error);
			if (image != null) this.onAssetReadFailure();
		}
	}

	public async playFile() {
		const media = this.mediaElement.value;
		const signal = this.lifetime?.signal;
		if (media == null || signal == null) return;
		// GsVideoControlsからの複数要求で同じ要素のMediaElementAudioSourceNodeを重複作成しない。
		this.fileAudioConnection ??= this.connectFileAudio(media, signal).catch(error => {
			if (!signal.aborted) this.fileAudioConnection = null;
			throw error;
		});
		await this.fileAudioConnection;
		if (!signal.aborted) await media.play();
	}

	public async startCapture() {
		const selection = this.selection.value;
		if (!this.active.value || selection.kind === 'asset' || selection.deviceId == null || this.captureStatus.value !== 'idle') return;
		this.releaseSource();
		const signal = this.createLifetime();
		this.captureStatus.value = 'connecting';
		const captureWebcamAudio = selection.kind === 'webcam' && this.captureWebcamAudio.value;
		// 許可応答後にユーザー操作の有効期間が過ぎていても音声を扱えるよう、先にAudioContextの再開を始める。
		const output = selection.kind === 'microphone' || captureWebcamAudio ? this.audioOutput.getOutput() : null;
		void output?.catch(() => {});
		try {
			const device = previewDeviceConstraint(selection.deviceId);
			const stream = await openPreviewDevice(selection.kind === 'webcam'
				? { video: device, audio: false }
				: { video: false, audio: { ...audioCaptureConstraints, ...(device === true ? {} : device) } }, signal);
			if (stream == null || signal.aborted) return;
			this.deviceRevision.value++;
			const track = selection.kind === 'webcam' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
			track.addEventListener('ended', () => this.failSource(i18n.ts._EffectPreview.DeviceUnavailable), { once: true, signal });
			if (selection.kind === 'webcam') {
				const video = this.createVideo(signal);
				video.muted = true;
				video.srcObject = stream;
				await video.play();
				if (signal.aborted) return;
				this.captureStatus.value = 'live';
				if (output != null) await this.connectWebcamAudio(track.getSettings().groupId, output, signal);
			} else {
				await this.connectLiveAudio(stream, output!, signal);
				if (!signal.aborted) this.captureStatus.value = 'live';
			}
		} catch (error) {
			if (!signal.aborted) this.failSource(this.describeError(error));
		}
	}

	public stopCapture() {
		this.releaseSource();
	}

	public setMonitoringEnabled(enabled: boolean) {
		if (this.audioConnection == null) return;
		this.audioConnection.setEnabled(enabled);
		this.monitoringEnabled.value = enabled;
	}

	public dispose() {
		this.active.value = false;
		this.releaseSource();
	}

	private openAsset(asset: Asset) {
		const file = asset.fileData;
		const signal = this.createLifetime();
		const isImage = asset.fileDataType.startsWith('image/');
		const isVideo = asset.fileDataType.startsWith('video/');
		try {
			if (isImage) {
				this.image = file;
				void this.restartRenderer();
				return;
			}
			const url = getFileSourceUrl(file);
			signal.addEventListener('abort', () => releaseFileSourceUrl(file, url), { once: true });
			const media = isVideo ? this.createVideo(signal) : this.createMediaElement('audio', signal);
			media.crossOrigin = 'anonymous';
			const position = this.lastAssetPosition?.assetId === asset.id ? this.lastAssetPosition.seconds : 0;
			this.currentTime.value = position;
			media.addEventListener('loadedmetadata', () => {
				if (position > 0) media.currentTime = Math.min(media.duration, position);
			}, { once: true, signal });
			const rememberTime = () => {
				this.currentTime.value = media.currentTime;
				this.lastAssetPosition = { assetId: asset.id, seconds: media.currentTime };
			};
			for (const event of ['timeupdate', 'seeked', 'pause', 'ended'] as const) media.addEventListener(event, rememberTime, { signal });
			media.addEventListener('error', () => {
				this.failSource(media.error?.message || i18n.ts._MediaPlayer.AssetUnavailable);
				this.onAssetReadFailure();
			}, { signal });
			this.mediaElement.value = media;
			media.src = url;
		} catch (error) {
			this.failSource(this.describeError(error));
			this.onAssetReadFailure();
		}
	}

	private createMediaElement<K extends 'audio' | 'video'>(tagName: K, signal: AbortSignal): HTMLElementTagNameMap[K] {
		const media = window.document.createElement(tagName);
		media.preload = 'auto';
		signal.addEventListener('abort', () => {
			media.pause();
			media.srcObject = null;
			media.removeAttribute('src');
			media.load();
		}, { once: true });
		return media;
	}

	private createVideo(signal: AbortSignal) {
		const video = this.createMediaElement('video', signal);
		this.video = video;
		video.playsInline = true;
		const send = () => this.sendVideoFrame();
		const onFrame = () => {
			frameCallback = video.requestVideoFrameCallback(onFrame);
			send();
		};
		let frameCallback = video.requestVideoFrameCallback(onFrame);
		video.addEventListener('loadeddata', send, { signal });
		video.addEventListener('seeked', send, { signal });
		signal.addEventListener('abort', () => video.cancelVideoFrameCallback(frameCallback), { once: true });
		void this.restartRenderer();
		return video;
	}

	private sendVideoFrame() {
		const video = this.video;
		if (video == null || !this.renderer.isReady.value || !isVideoFrameAvailable(video) || video.seeking) return;
		this.renderer.showVideoFrame(new VideoFrame(video), { width: video.videoWidth, height: video.videoHeight });
	}

	private async connectFileAudio(media: HTMLMediaElement, signal: AbortSignal) {
		const output = await this.audioOutput.getOutput();
		if (signal.aborted) return;
		const source = (output.context as AudioContext).createMediaElementSource(media);
		source.connect(output);
		signal.addEventListener('abort', () => source.disconnect(), { once: true });
	}

	private async connectLiveAudio(stream: MediaStream, output: Promise<GainNode>, signal: AbortSignal) {
		const { context } = await output;
		if (signal.aborted) return;
		const track = stream.getAudioTracks()[0];
		if (track.readyState === 'ended') throw new Error(i18n.ts._EffectPreview.DeviceUnavailable);
		const source = (context as AudioContext).createMediaStreamSource(stream);
		const connection = this.audioOutput.connectLivePreviewAudio(source);
		this.audioConnection = connection;
		this.audioCaptureSettings.value = track.getSettings();
		this.monitoringAvailable.value = true;
		const disconnect = () => {
			if (this.audioConnection !== connection) return;
			connection.dispose();
			this.audioConnection = null;
			this.monitoringAvailable.value = false;
			this.monitoringEnabled.value = false;
			this.audioCaptureSettings.value = null;
		};
		signal.addEventListener('abort', disconnect, { once: true });
		track.addEventListener('ended', disconnect, { once: true, signal });
	}

	private async connectWebcamAudio(groupId: string | undefined, output: Promise<GainNode>, signal: AbortSignal) {
		const audioLifetime = new AbortController();
		const audioSignal = AbortSignal.any([signal, audioLifetime.signal]);
		try {
			if (groupId != null && groupId !== '') {
				const stream = await openPreviewDevice({ video: false, audio: { ...audioCaptureConstraints, groupId: { exact: groupId } } }, audioSignal);
				if (stream == null || audioSignal.aborted) return;
				if (stream.getAudioTracks()[0]?.getSettings().groupId === groupId) {
					await this.connectLiveAudio(stream, output, audioSignal);
					return;
				}
			}
		} catch {
			// 音声の許可や利用可否で、すでに表示中のカメラ映像を止めない。
		}
		audioLifetime.abort();
		if (!signal.aborted) this.errorMessage.value = i18n.ts._EffectPreview.WebcamAudioUnavailable;
	}

	private createLifetime() {
		this.lifetime = new AbortController();
		return this.lifetime.signal;
	}

	private releaseSource() {
		const media = this.mediaElement.value;
		const assetId = this.selection.value.kind === 'asset' ? this.selection.value.assetId : null;
		if (media != null && assetId != null && media.readyState >= media.HAVE_METADATA) {
			this.lastAssetPosition = { assetId, seconds: media.currentTime };
		}
		this.rendererRequest++;
		this.lifetime?.abort();
		this.lifetime = null;
		this.renderer.stop();
		this.renderer.errorMessage.value = null;
		this.mediaElement.value = null;
		this.currentTime.value = 0;
		this.video = null;
		this.image = null;
		this.assetFile = null;
		this.fileAudioConnection = null;
		this.captureStatus.value = 'idle';
		this.errorMessage.value = null;
	}

	private failSource(message: string) {
		const file = this.assetFile;
		this.releaseSource();
		this.assetFile = file;
		this.errorMessage.value = message;
	}

	private describeError(error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}
}
