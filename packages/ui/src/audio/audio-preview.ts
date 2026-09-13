import { ref } from 'vue';
import type { MeterReading, PreviewOptions, PreviewRequest, PreviewResponse, PreviewSize } from './audio-preview-types.ts';

// UIは接続と設定変更だけを担当し、PCMや描画フレームを中継しない。
export class AudioPreview {
	public readonly sampleRate = ref(48000);
	private worker: Worker | null = null;
	private nextId = 0;
	private meters = new Map<number, (reading: MeterReading) => void>();
	private errors = new Map<number, (message: string) => void>();

	private send(message: PreviewRequest, transfer: Transferable[] = []) {
		if (!this.worker) {
			this.worker = new Worker(new URL('./audio-preview.worker.ts', import.meta.url), { type: 'module' });
			this.worker.onmessage = ({ data }: MessageEvent<PreviewResponse>) => {
				if (data.type === 'meters') {
					try { for (const reading of data.readings) this.meters.get(reading.id)?.(reading); }
					finally { this.send({ type: 'metersReceived' }); }
				} else if (data.type === 'sampleRate') this.sampleRate.value = data.sampleRate;
				else if (data.id !== undefined) this.errors.get(data.id)?.(data.message);
				else for (const error of [...this.errors.values()]) error(data.message);
			};
			this.worker.onerror = event => {
				for (const error of [...this.errors.values()]) error(event.message);
			};
		}
		this.worker.postMessage(message, transfer);
	}

	public attachAudio(port: MessagePort) { this.send({ type: 'audio', port }, [port]); }
	public resetAudio() { this.send({ type: 'resetAudio' }); }
	public setRunning(running: boolean) { this.send({ type: 'running', running }); }

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
		this.send({ type: 'add', id, canvas: offscreen, options }, [offscreen]);
		return {
			configure: (options: PreviewOptions) => this.send({ type: 'options', id, options }),
			resize: (size: PreviewSize) => this.send({ type: 'resize', id, ...size }),
			dispose: () => { this.errors.delete(id); this.send({ type: 'remove', id }); },
		};
	}

	public dispose() {
		this.worker?.terminate();
		this.worker = null;
		this.meters.clear();
		this.errors.clear();
	}
}
