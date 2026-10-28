import { computed, readonly, ref } from 'vue';
import type { MeterReading, PreviewOptions, PreviewRequest, PreviewResponse, PreviewSize } from './audio-preview-types.ts';

// UIは接続と設定変更だけを担当し、PCMや描画フレームを中継しない。
export class AudioPreview {
	public readonly sampleRate = ref(48000);
	private worker: Worker | null = null;
	private workerFailed = false;
	private nextId = 0;
	private meters = new Map<number, (reading: MeterReading) => void>();
	private errors = new Map<number, (message: string) => void>();
	private analysisEnabled = ref(true);
	public readonly isAnalysisEnabled = readonly(this.analysisEnabled);
	private renderingSuspended = ref(false);
	public readonly isRenderingSuspended = readonly(this.renderingSuspended);
	public readonly isRenderingEnabled = computed(() => this.analysisEnabled.value && !this.renderingSuspended.value);
	private nextRenderingStateRequestId = 0;
	private renderingStateRequests = new Map<number, () => void>();

	private send(message: PreviewRequest, transfer: Transferable[] = []) {
		if (this.worker == null) {
			this.worker = new Worker(new URL('./audio-preview.worker.ts', import.meta.url), { type: 'module' });
			this.worker.onmessage = ({ data }: MessageEvent<PreviewResponse>) => {
				if (data.type === 'meters') {
					try {
						for (const reading of data.readings) {
							this.meters.get(reading.id)?.(reading);
						}
					} finally {
						this.send({ type: 'metersReceived' });
					}
				} else if (data.type === 'renderingStateApplied') {
					this.renderingStateRequests.get(data.requestId)?.();
					this.renderingStateRequests.delete(data.requestId);
				} else if (data.type === 'sampleRate') this.sampleRate.value = data.sampleRate;
				else if (data.id != null) this.errors.get(data.id)?.(data.message);
				else for (const error of [...this.errors.values()]) error(data.message);
			};
			this.worker.onerror = event => {
				// Workerが失敗した場合も描画は継続できない。休止の確認待ちを残すと、
				// 音声モニターの障害によって映像の書き出しまで開始不能になる。
				this.workerFailed = true;
				this.finishRenderingStateRequests();
				for (const error of [...this.errors.values()]) error(event.message);
			};
			// Analyze無効時や休止中にパネルを開いても、最初の描画より先に停止状態を渡す。
			this.worker.postMessage({ type: 'renderingSuspended', suspended: !this.isRenderingEnabled.value, requestId: null } satisfies PreviewRequest);
		}
		this.worker.postMessage(message, transfer);
	}

	public attachAudio(port: MessagePort) { this.send({ type: 'audio', port }, [port]); }
	public resetAudio() { this.send({ type: 'resetAudio' }); }
	public setRunning(running: boolean) { this.send({ type: 'running', running }); }

	/** 監視パネルの解析・描画だけを切り替える。音声履歴とメーターの配送は維持する。 */
	public setAnalysisEnabled(enabled: boolean): Promise<void> {
		this.analysisEnabled.value = enabled;
		return this.applyRenderingState();
	}

	/** 再生位置・履歴・Canvasの所有権を保持し、モニターの描画だけを休止する。 */
	public setRenderingSuspended(suspended: boolean): Promise<void> {
		this.renderingSuspended.value = suspended;
		return this.applyRenderingState();
	}

	private applyRenderingState(): Promise<void> {
		// ユーザー設定と一時休止を別に持ち、書き出し後の復帰や休止中の設定変更で
		// もう一方の停止理由を解除しない。Workerには実際に描画できる状態だけを送る。
		if (this.worker == null || this.workerFailed) return Promise.resolve();
		const requestId = this.nextRenderingStateRequestId++;
		const { promise, resolve } = Promise.withResolvers<void>();
		this.renderingStateRequests.set(requestId, resolve);
		this.send({ type: 'renderingSuspended', suspended: !this.isRenderingEnabled.value, requestId });
		return promise;
	}

	private finishRenderingStateRequests() {
		for (const resolve of this.renderingStateRequests.values()) resolve();
		this.renderingStateRequests.clear();
	}

	public attachMeter(port: MessagePort, receive: (reading: MeterReading) => void) {
		const id = this.nextId++;
		this.meters.set(id, receive);
		this.send({ type: 'meter', id, port }, [port]);
		return () => { this.meters.delete(id); this.send({ type: 'removeMeter', id }); };
	}

	public add(canvas: HTMLCanvasElement, options: PreviewOptions, error: (message: string) => void) {
		const id = this.nextId++;
		const offscreen = canvas.transferControlToOffscreen();
		this.errors.set(id, error);
		this.send({
			type: 'add',
			id,
			canvas: offscreen,
			options,
		}, [offscreen]);
		return {
			configure: (options: PreviewOptions) => this.send({ type: 'options', id, options }),
			resize: (size: PreviewSize) => this.send({ type: 'resize', id, ...size }),
			dispose: () => { this.errors.delete(id); this.send({ type: 'remove', id }); },
		};
	}

	public dispose() {
		this.worker?.terminate();
		this.worker = null;
		this.workerFailed = false;
		this.finishRenderingStateRequests();
		this.meters.clear();
		this.errors.clear();
	}
}
