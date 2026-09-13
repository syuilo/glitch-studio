import { ref, shallowReactive } from 'vue';
import { createRendererWorker } from '@glitch/renderer/client.ts';
import { deepEqual } from '@glitch/shared/utility/deep-equal.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { projectAudioSourceId } from '@glitch/shared/audio.ts';
import { isVideoFrameAvailable, playVideoAfterFirstFrameIsReady } from './utility/video.ts';
import { AudioInputs } from './audio/audio-inputs.ts';
import { setupWebcam } from './utility/webcam.ts';
import type { Asset, GsAutomation, GsNode, Macro, Player } from '@glitch/shared/types.ts';
import type { Renderer } from '@glitch/renderer/renderer.ts';
import type { EffectStatus } from '@glitch/shared/effect-status.ts';
import * as ui from '@/ui.ts';

type RendererMethods = {
	[K in keyof Renderer as Renderer[K] extends (...args: never[]) => unknown ? K : never]: Renderer[K];
};

export class Engine {
	public canvas: HTMLCanvasElement;
	public histogramCanvas: HTMLCanvasElement;
	public waveformCanvas: HTMLCanvasElement;

	//private renderer: Renderer | null = null;
	private rendererWorker: Worker | null = null;

	private enableFloat32Filtering = false;
	private intermediateTextureFormat = navigator.gpu.getPreferredCanvasFormat(); // TODO: 設定でrgba16floatも指定できるようにする(レンダリングの精度は上がるがパフォーマンスは落ちる)
	private enableStats = true;
	private nodes: GsNode[] = [];
	private assets: Asset[] = [];
	private players: Player[] = [];
	private macros: Macro[] = [];
	private automations: GsAutomation[] = [];
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
	private fpsLimit: number | null;
	public gpuAverageDisplayFast = ref(0);
	public gpuAverageDisplayMedium = ref(0);
	public gpuAverageDisplaySlow = ref(0);
	public fpsDisplay = ref(0);
	public gpuMemoryUsage = ref<ReturnType<Renderer['gpuMemory']['getUsage']> | null>(null);
	public isReady = ref(false);
	public effectStatuses = shallowReactive(new Map<string, EffectStatus>());

	constructor(options: {
		fpsLimit: number | null;
	}) {
		this.canvas = window.document.createElement('canvas');
		this.canvas.style.imageRendering = 'pixelated';
		this.histogramCanvas = window.document.createElement('canvas');
		this.histogramCanvas.width = 256;
		this.histogramCanvas.height = 150;
		this.histogramCanvas.style.width = '100%';
		this.histogramCanvas.style.height = '100%';
		this.waveformCanvas = window.document.createElement('canvas');
		this.waveformCanvas.width = 512;
		this.waveformCanvas.height = 256;
		this.waveformCanvas.style.width = '100%';
		this.waveformCanvas.style.height = '100%';
		this.fpsLimit = options.fpsLimit;
	}

	private call<FN extends keyof RendererMethods>(fn: FN, args: Parameters<RendererMethods[FN]>, options?: StructuredSerializeOptions | Transferable[]): void {
		if (!this.isReady.value) {
			throw new Error('Renderer is not initialized');
		}
		if (this.rendererWorker != null) {
			this.rendererWorker.postMessage({ type: 'call', fn, args }, Array.isArray(options) ? { transfer: options } : options);
		//} else if (this.renderer != null) {
		//	this.renderer[fn](...args);
		} else {
			throw new Error('Renderer is not initialized');
		}
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
		// Scaled preview dimensions can be fractional. Use the same integer pixel
		// dimensions for the canvas, textures, shader uniforms, and storage buffers.
		resolution = {
			width: Math.max(1, Math.floor(resolution.width)),
			height: Math.max(1, Math.floor(resolution.height)),
		};

		if (resolution.width > 8192 || resolution.height > 8192) {
			ui.alert({
				type: 'error',
				text: 'maximum supported resolution is 8192x8192',
			});
			throw new Error('maximum supported resolution is 8192x8192');
		}

		this.canvas.width = resolution.width;
		this.canvas.height = resolution.height;

		const offscreen = this.canvas.transferControlToOffscreen();
		const histogramOffscreen = this.histogramCanvas.transferControlToOffscreen();
		const waveformOffscreen = this.waveformCanvas.transferControlToOffscreen();

		const { promise: ready, resolve: resolveReady } = Promise.withResolvers<void>();

		this.rendererWorker = createRendererWorker();
		this.rendererWorker.postMessage({
			type: 'init',
			canvas: offscreen,
			histogramCanvas: histogramOffscreen,
			waveformCanvas: waveformOffscreen,
			options: {
				resolution,
				enableFloat32Filtering: this.enableFloat32Filtering,
				intermediateTextureFormat: this.intermediateTextureFormat,
				fpsLimit: this.fpsLimit,
				enableStats: this.enableStats,
				assets: this.assets,
				macros: this.macros,
				automations: this.automations,
				nodes: this.nodes,
			},
		}, [offscreen, histogramOffscreen, waveformOffscreen]);
		this.rendererWorker.onmessage = (event) => {
			switch (event.data?.type) {
				case 'inited': {
					this.isReady.value = true;
					for (const playerId of this.pendingVideoFrames.keys()) this.sendPendingVideoFrame(playerId);
					console.log('Renderer worker initialized!');
					resolveReady();
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
				case 'effectStatus': {
					const { nodeId, status } = event.data;
					if (status) this.effectStatuses.set(nodeId, status);
					else this.effectStatuses.delete(nodeId);
					break;
				}
				case 'stats': {
					const { stats } = event.data;
					this.fpsDisplay.value = stats.fpsAverage;
					if (this.enableStats) {
						// テクスチャのコピーとか全ての処理が計測できているわけではなく、実際よりも少し小さい値になっていると思われるので、少し盛っておく
						this.gpuAverageDisplayFast.value = stats.gpuAverageFast * 1.2;
						this.gpuAverageDisplayMedium.value = stats.gpuAverageMedium * 1.2;
						this.gpuAverageDisplaySlow.value = stats.gpuAverageSlow * 1.2;
					}
					break;
				}
				default: {
					console.warn('Unrecognized message from worker:', event.data?.type);
				}
			}
		};

		await ready;
	}

	public startRenderLoop() {
		this.call('startRenderLoop', []);
	}

	public stopRenderLoop() {
		this.call('stopRenderLoop', []);
	}

	public async updatePlayers(newPlayers: Player[]) {
		const oldPlayers = this.players;
		const players = deepClone(newPlayers);
		this.players = players;

		for (const [id, video] of this.videoElements) {
			const oldPlayer = oldPlayers.find(player => player.id === id);
			const newPlayer = players.find(player => player.id === id);
			const asset = newPlayer?.type === 'asset' ? this.assets.find(asset => asset.id === newPlayer.assetId) : null;
			if (!newPlayer || oldPlayer?.type !== newPlayer.type || !deepEqual(oldPlayer?.assetId, newPlayer.assetId)
				|| (newPlayer.type === 'asset' && this.playerAssetFiles.get(id) !== asset?.fileData)) {
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
				const asset = player.type === 'asset' ? this.assets.find(asset => asset.id === player.assetId) : null;
				if (player.type === 'asset' && !asset) continue;
				const video = window.document.createElement(asset?.fileDataType.startsWith('audio/') ? 'audio' : 'video');
				video.loop = true;
				video.preload = 'auto';
				video.volume = 1;
				this.videoElements.set(player.id, video);
				if (player.type === 'asset') this.audioInputs.registerPlayer(player.id, video);
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

				if (player.type === 'asset') {
					this.playerAssetFiles.set(player.id, asset!.fileData);
					video.src = URL.createObjectURL(asset!.fileData);
				} else if (player.type === 'webcam' && video instanceof HTMLVideoElement) {
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

	public updateNodes(newNodes: GsNode[]) {
		this.nodes = deepClone(newNodes);
		this.call('updateNodes', [this.nodes]);
	}

	public getVideoElement(playerId: Player['id']): HTMLVideoElement | null {
		const media = this.videoElements.get(playerId);
		return media instanceof HTMLVideoElement ? media : null;
	}

	public getMediaElement(playerId: Player['id']): HTMLMediaElement | null {
		return this.videoElements.get(playerId) ?? null;
	}

	public async playPlayer(playerId: Player['id']) {
		if (this.players.find(player => player.id === playerId)?.type === 'asset') await this.audioInputs.play(playerId);
		else await this.videoElements.get(playerId)?.play();
	}

	public get previewVolume() { return this.audioInputs.previewVolume; }
	public setPreviewVolume(volume: number) { this.audioInputs.setPreviewVolume(volume); }
	public get audioPreview() { return this.audioInputs.preview; }
	public retainAudioOutputCapture() { return this.audioInputs.retainOutputCapture(); }
	public get audioOutputLevels() { return this.audioInputs.getLevels(projectAudioSourceId); }

	public getPlayerLevels(playerId: Player['id']) { return this.audioInputs.getPlayerLevels(playerId); }

	public updateMacros(newMacros: Macro[]) {
		this.macros = deepClone(newMacros);
		this.call('updateMacros', [this.macros]);
	}

	public updateAutomations(newAutomations: GsAutomation[]) {
		this.automations = deepClone(newAutomations);
		this.call('updateAutomations', [this.automations]);
	}

	public async updateAssets(newAssets: Asset[]) {
		this.assets = deepClone(newAssets);
		await this.call('updateAssets', [this.assets]);
		await this.updatePlayers(this.players);
		await this.updateNodes(this.nodes);
	}

	public async updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.call('updatePointerPosition', [newPointerPosition]);
	}

	public changeFpsLimit(newFpsLimit: number | null) {
		this.fpsLimit = newFpsLimit;
		this.call('changeFpsLimit', [this.fpsLimit]);
	}

	public resize(resolution: {
		width: number;
		height: number;
	}) {
		if (this.rendererWorker != null) {
			this.rendererWorker.postMessage({ type: 'resize', resolution });
		}
	}

	public destroy() {
		this.effectStatuses.clear();
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

	public reload() {
		// TODO
	}
}
