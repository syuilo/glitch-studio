import { projectAudioSourceId } from '@gs/shared/audio.ts';
import { ref, shallowReactive } from 'vue';
import workletUrl from './audio-capture.worklet.js?url';
import { AudioPreview } from './audio-preview.ts';
import type { AudioSourceId } from '@gs/shared/audio.ts';

const silentLevels = [0, 0] as const;

function rampPreviewGain(node: GainNode, value: number) {
	const now = node.context.currentTime;
	// 操作途中の値から短く補間し、急なゲイン変更によるクリック音を避ける。
	node.gain.cancelAndHoldAtTime(now);
	node.gain.linearRampToValueAtTime(value, now + 0.015);
}

export type AudioCapture = {
	setState: (active: boolean, generation: number) => void;
	dispose: () => void;
};

/** アプリが所有する音声出力。映像レンダラーや個々の再生元の寿命から独立させる。 */
export class AudioOutput {
	private disposal: Promise<void> | null = null;
	private context: AudioContext | null = null;
	private output: GainNode | null = null;
	private analysisMix: GainNode | null = null;
	private playbackMix: GainNode | null = null;
	private readonly outputCaptures: AudioCapture[] = [];
	private outputCaptureUsers = 0;
	public readonly preview = new AudioPreview();
	private previewGain: GainNode | null = null;
	public readonly previewVolume = ref(0.5);
	private modules = new WeakMap<BaseAudioContext, Promise<void>>();
	private levels = shallowReactive(new Map<AudioSourceId, readonly [number, number]>());

	public get outputLevels() { return this.getLevels(projectAudioSourceId); }

	// 任意のAudioNodeからPCMやピークレベルを取得する。
	// prepare(context)の完了後に呼ぶ。接続中にawaitせず、解放済みの入力の再接続を防ぐ。
	public captureSource(source: AudioNode, { pcm, meterId }: {
		pcm?: { attach: (port: MessagePort) => void; reset: () => void; running?: (running: boolean) => void };
		meterId?: AudioSourceId;
	}): AudioCapture {
		const context = source.context as AudioContext;
		const capture = new AudioWorkletNode(context, 'glitch-audio-capture', {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [1],
			channelCountMode: 'max',
			channelInterpretation: 'discrete',
		});
		if (pcm != null) {
			const channel = new MessageChannel();
			try {
				pcm.attach(channel.port2);
			} catch (error) {
				channel.port1.close();
				channel.port2.close();
				capture.port.close();
				throw error;
			}
			capture.port.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
		}
		let active = false;
		let generation = 0;
		let meterGeneration = 0;
		const clearLevels = () => { if (meterId != null) this.levels.set(meterId, silentLevels); };
		let releaseMeter: (() => void) | null = null;
		if (meterId != null) {
			clearLevels();
			const meter = new MessageChannel();
			releaseMeter = this.preview.attachMeter(meter.port2, data => {
				if (active && data.generation === meterGeneration && context.state === 'running') {
					this.levels.set(meterId, [data.left, data.right]);
				}
			});
			capture.port.postMessage({ type: 'meter', port: meter.port1 }, [meter.port1]);
		}
		const onContextState = () => {
			// 停止前のバッチが再開後に届いても表示しない。PCMの世代とは独立に進める。
			const running = context.state === 'running';
			if (meterId != null) {
				capture.port.postMessage({ type: 'meterState', generation: ++meterGeneration });
				if (!running) clearLevels();
			}
			pcm?.running?.(running);
		};
		context.addEventListener('statechange', onContextState);
		onContextState();
		source.connect(capture);
		capture.connect(context.destination);
		capture.onprocessorerror = () => { active = false; clearLevels(); pcm?.reset(); };
		return {
			setState: (nextActive, nextGeneration) => {
				if (!nextActive || generation !== nextGeneration) clearLevels();
				active = nextActive;
				generation = nextGeneration;
				capture.port.postMessage({
					type: 'state',
					active,
					generation,
					meterGeneration: ++meterGeneration,
				});
			},
			dispose: () => {
				active = false;
				context.removeEventListener('statechange', onContextState);
				releaseMeter?.();
				if (meterId != null) this.levels.delete(meterId);
				capture.onprocessorerror = null;
				capture.port.postMessage({ type: 'dispose' });
				source.disconnect(capture);
				capture.disconnect();
				capture.port.close();
				pcm?.reset();
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
			if (--this.outputCaptureUsers === 0) this.disposeOutputCaptures();
		};
	}

	private disposeOutputCaptures() {
		for (const capture of this.outputCaptures.splice(0)) capture.dispose();
	}

	private ensureOutputCapture() {
		if (this.analysisMix == null || this.playbackMix == null || this.outputCaptures.length > 0 || this.outputCaptureUsers === 0) return;
		try {
			// パネルは試聴設定に関係なくライブ入力も解析する。フッターは試聴へ送る信号のピークを表示する。
			this.outputCaptures.push(this.captureSource(this.analysisMix, {
				pcm: {
					attach: port => this.preview.attachAudio(port),
					reset: () => this.preview.resetAudio(),
					running: running => this.preview.setRunning(running),
				},
			}));
			this.outputCaptures.push(this.captureSource(this.playbackMix, { meterId: projectAudioSourceId }));
			for (const capture of this.outputCaptures) capture.setState(true, 0);
		} catch (error) {
			this.disposeOutputCaptures();
			throw error;
		}
	}

	private ensureOutput(context: AudioContext) {
		if (!this.output) {
			// 両方のミックスでモノラルを左右へ複製し、ステレオのレベルを測れるようにする。
			const stereo: GainOptions = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
			this.output = new GainNode(context, stereo);
			this.analysisMix = new GainNode(context, stereo);
			this.playbackMix = new GainNode(context, stereo);
			this.previewGain = new GainNode(context, { gain: this.previewVolume.value });
			this.output.connect(this.analysisMix);
			this.output.connect(this.playbackMix);
			this.playbackMix.connect(this.previewGain);
			this.previewGain.connect(context.destination);
		}
		return this.output!;
	}

	public async getOutput(): Promise<GainNode> {
		if (this.disposal != null) throw new Error('Audio output was disposed.');
		this.context ??= new AudioContext();
		const context = this.context;
		await Promise.all([context.resume(), this.prepare(context)]);
		if (this.context !== context) throw new Error('Audio output was disposed.');
		const output = this.ensureOutput(context);
		this.ensureOutputCapture();
		return output;
	}

	/** getOutput()で準備済みのContextに、現在のライブ入力を接続する。 */
	public connectLivePreviewAudio(source: AudioNode) {
		const analysisMix = this.analysisMix!;
		const monitoringGain = new GainNode(source.context, { gain: 0 });
		source.connect(analysisMix);
		source.connect(monitoringGain);
		// 試聴オンのライブ入力を通常の再生音と合流させ、共通のプレビュー音量の手前で計測する。
		monitoringGain.connect(this.playbackMix!);
		return {
			setEnabled: (enabled: boolean) => rampPreviewGain(monitoringGain, enabled ? 1 : 0),
			dispose: () => {
				source.disconnect(analysisMix);
				source.disconnect(monitoringGain);
				monitoringGain.disconnect();
			},
		};
	}

	public setPreviewVolume(volume: number) {
		if (!Number.isFinite(volume)) return;
		this.previewVolume.value = Math.min(1, Math.max(0, volume));
		if (!this.previewGain) return;
		rampPreviewGain(this.previewGain, this.previewVolume.value);
	}

	public getLevels(id: AudioSourceId): readonly [number, number] {
		return this.levels.get(id) ?? silentLevels;
	}

	/** 再生元を停止・切断した後、編集セッションの終了時に呼ぶ。 */
	public dispose(): Promise<void> {
		if (this.disposal != null) return this.disposal;
		this.disposeOutputCaptures();
		this.preview.dispose();
		this.output?.disconnect();
		this.output = null;
		this.analysisMix?.disconnect();
		this.analysisMix = null;
		this.playbackMix?.disconnect();
		this.playbackMix = null;
		this.previewGain?.disconnect();
		this.previewGain = null;
		this.disposal = this.context?.close() ?? Promise.resolve();
		this.context = null;
		return this.disposal;
	}
}
