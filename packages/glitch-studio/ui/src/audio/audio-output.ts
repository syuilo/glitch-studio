import { projectAudioSourceId } from '@gs/shared/audio.ts';
import { ref, shallowReactive } from 'vue';
import workletUrl from './audio-capture.worklet.js?url';
import { AudioPreview } from './audio-preview.ts';
import type { AudioSourceId } from '@gs/shared/audio.ts';

const silentLevels = [0, 0] as const;

export type AudioCapture = {
	setState: (active: boolean, generation: number) => void;
	dispose: () => void;
};

/** アプリが所有する音声出力。映像レンダラーや個々の再生元の寿命から独立させる。 */
export class AudioOutput {
	private context: AudioContext | null = null;
	private output: GainNode | null = null;
	private outputCapture: AudioCapture | null = null;
	private outputCaptureUsers = 0;
	public readonly preview = new AudioPreview();
	private previewGain: GainNode | null = null;
	public readonly previewVolume = ref(0.5);
	private modules = new WeakMap<BaseAudioContext, Promise<void>>();
	private levels = shallowReactive(new Map<AudioSourceId, readonly [number, number]>());

	public get outputLevels() { return this.getLevels(projectAudioSourceId); }

	// Playerの知識を持たない接続口。将来は音声グラフの出力AudioNodeも渡せる。
	// prepare(context)の完了後に呼ぶ。接続中にawaitせず、削除済みPlayerの再接続を防ぐ。
	public captureSource(id: AudioSourceId, source: AudioNode, handlers: { attach: (port: MessagePort) => void; reset: () => void; running?: (running: boolean) => void }): AudioCapture {
		const context = source.context as AudioContext;
		const capture = new AudioWorkletNode(context, 'glitch-audio-capture', {
			numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
			channelCountMode: 'max', channelInterpretation: 'discrete',
		});
		const channel = new MessageChannel();
		const reset = handlers.reset;
		try {
			handlers.attach(channel.port2);
		} catch (error) {
			channel.port1.close();
			channel.port2.close();
			capture.port.close();
			throw error;
		}
		capture.port.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
		let active = false;
		let generation = 0;
		let meterGeneration = 0;
		const clearLevels = () => this.levels.set(id, silentLevels);
		clearLevels();
		const meter = new MessageChannel();
		const releaseMeter = this.preview.attachMeter(meter.port2, data => {
			if (active && data.generation === meterGeneration && context.state === 'running') {
				this.levels.set(id, [data.left, data.right]);
			}
		});
		capture.port.postMessage({ type: 'meter', port: meter.port1 }, [meter.port1]);
		const onContextState = () => {
			// 停止前のバッチが再開後に届いても表示しない。PCMの世代とは独立に進める。
			capture.port.postMessage({ type: 'meterState', generation: ++meterGeneration });
			if (context.state !== 'running') clearLevels();
			handlers.running?.(context.state === 'running');
		};
		context.addEventListener('statechange', onContextState);
		onContextState();
		source.connect(capture);
		capture.connect(context.destination);
		capture.onprocessorerror = () => { active = false; clearLevels(); reset(); };
		return {
			setState: (nextActive, nextGeneration) => {
				if (!nextActive || generation !== nextGeneration) clearLevels();
				active = nextActive;
				generation = nextGeneration;
				capture.port.postMessage({ type: 'state', active, generation, meterGeneration: ++meterGeneration });
			},
			dispose: () => {
				active = false;
				context.removeEventListener('statechange', onContextState);
				releaseMeter();
				this.levels.delete(id);
				capture.onprocessorerror = null;
				capture.port.postMessage({ type: 'dispose' });
				source.disconnect(capture);
				capture.disconnect();
				capture.port.close();
				reset();
			},
		};
	}

	public prepare(context: BaseAudioContext): Promise<void> {
		let ready = this.modules.get(context);
		if (!ready) {
			ready = context.audioWorklet.addModule(workletUrl).catch(error => {
				this.modules.delete(context);
				throw error;
			});
			this.modules.set(context, ready);
		}
		return ready;
	}

	public retainOutputCapture(): () => void {
		this.outputCaptureUsers++;
		try {
			this.ensureOutputCapture();
		} catch (error) {
			this.outputCaptureUsers--;
			throw error;
		}
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (--this.outputCaptureUsers === 0) {
				this.outputCapture?.dispose();
				this.outputCapture = null;
			}
		};
	}

	private ensureOutputCapture() {
		if (!this.output || this.outputCapture || this.outputCaptureUsers === 0) return;
		// 複数パネルでPCM履歴を共有し、試聴音量には影響されない位置で分岐する。
		this.outputCapture = this.captureSource(projectAudioSourceId, this.output, {
			attach: port => this.preview.attachAudio(port),
			reset: () => this.preview.resetAudio(),
			running: running => this.preview.setRunning(running),
		});
		this.outputCapture.setState(true, 0);
	}

	private ensureOutput(context: AudioContext) {
		if (!this.output) {
			// 各Playerの音量調整後を加算するプロジェクト出力。モノラルは左右へ複製する。
			this.output = new GainNode(context, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
			// 解析はoutputから分岐する。試聴音量はスピーカーへ向かう経路だけに適用する。
			this.previewGain = new GainNode(context, { gain: this.previewVolume.value });
			this.output.connect(this.previewGain);
			this.previewGain.connect(context.destination);
		}
		return this.output!;
	}

	public async getOutput(): Promise<GainNode> {
		this.context ??= new AudioContext();
		const context = this.context;
		await Promise.all([context.resume(), this.prepare(context)]);
		if (this.context !== context) throw new Error('Audio output was disposed.');
		const output = this.ensureOutput(context);
		this.ensureOutputCapture();
		return output;
	}

	public setPreviewVolume(volume: number) {
		if (!Number.isFinite(volume)) return;
		this.previewVolume.value = Math.min(1, Math.max(0, volume));
		if (!this.previewGain) return;
		const gain = this.previewGain.gain;
		const now = this.previewGain.context.currentTime;
		// 操作途中の値から短く補間し、急なゲイン変更によるクリック音を避ける。
		gain.cancelAndHoldAtTime(now);
		gain.linearRampToValueAtTime(this.previewVolume.value, now + 0.015);
	}

	public getLevels(id: AudioSourceId): readonly [number, number] {
		return this.levels.get(id) ?? silentLevels;
	}

	/** 再生元を停止・切断した後、アプリの終了時にだけ呼ぶ。 */
	public dispose() {
		this.outputCapture?.dispose();
		this.outputCapture = null;
		this.preview.dispose();
		this.output?.disconnect();
		this.output = null;
		this.previewGain?.disconnect();
		this.previewGain = null;
		void this.context?.close();
		this.context = null;
	}
}
