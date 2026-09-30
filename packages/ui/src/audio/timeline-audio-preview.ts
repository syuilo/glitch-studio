import { ref } from 'vue';
import workletUrl from './timeline-audio.worklet.js?url';
import type { Asset } from '@glitch/shared/types.ts';
import { getSceneAudioClips } from '@glitch/shared/timeline/scene-audio.ts';
import type { TimelineScene } from '@glitch/shared/timeline/types.ts';

type Clock = { contextFrame: number; playedFrames: number; running: boolean };

/** UIの再生状態とは独立した音声出力。1回の再生ごとにWorker/Workletを所有する。 */
export class TimelineAudioPreview {
	readonly buffering = ref(false);
	readonly error = ref<string | null>(null);
	private generation = 0;
	private worker: Worker | null = null;
	private node: AudioWorkletNode | null = null;
	private context: AudioContext | null = null;
	private modules = new WeakMap<AudioContext, Promise<void>>();
	private clocks: Clock[] = [];
	private startFrame = 0;
	private endFrame = 1;
	private requestedTime = 0;
	private rate = 48000;

	constructor(private getOutput: () => Promise<GainNode>, private getProject: () => { assets: Asset[]; timelineScenes: TimelineScene[]; sceneId: string | null }) {}

	start(time: number, duration: number) {
		this.stop();
		const generation = this.generation;
		this.requestedTime = time;
		this.error.value = null;
		this.buffering.value = true;
		void this.prepare(time, duration, generation).catch(error => {
			if (generation !== this.generation) return;
			this.stop();
			this.error.value = error instanceof Error ? error.message : String(error);
		});
	}

	private async prepare(time: number, duration: number, generation: number) {
		const output = await this.getOutput();
		if (generation !== this.generation) return;
		const context = output.context as AudioContext;
		let ready = this.modules.get(context);
		if (!ready) {
			ready = context.audioWorklet.addModule(workletUrl).catch(error => { this.modules.delete(context); throw error; });
			this.modules.set(context, ready);
		}
		await ready;
		if (generation !== this.generation) return;
		this.context = context;
		this.rate = context.sampleRate;
		this.endFrame = Math.max(1, Math.round(duration * this.rate / 1000));
		this.startFrame = Math.round(time * this.rate / 1000) % this.endFrame;
		const node = new AudioWorkletNode(context, 'glitch-timeline-audio', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
		this.node = node;
		const worker = new Worker(new URL('./timeline-audio.worker.ts', import.meta.url), { type: 'module' });
		this.worker = worker;
		const fail = (message: string) => {
			if (generation !== this.generation) return;
			this.requestedTime = this.currentTime();
			this.stop();
			this.error.value = message;
		};
		worker.onerror = event => fail(event.message);
		node.onprocessorerror = () => fail('Timeline audio processor failed.');
		worker.onmessage = ({ data }) => {
			if (generation !== this.generation) return;
			if (data.type === 'error') { fail(data.message); return; }
			node.port.postMessage(data, data.channels.map((channel: Float32Array) => channel.buffer));
		};
		node.port.onmessage = ({ data }) => {
			if (generation !== this.generation) return;
			if (data.type === 'pull') worker.postMessage({ type: 'pull' });
			else {
				this.clocks.push(data);
				if (this.clocks.length > 256) this.clocks.shift();
			}
		};
		const project = this.getProject();
		const clips = project.sceneId == null ? [] : getSceneAudioClips(project.timelineScenes, project.sceneId);
		const assetIds = new Set(clips.map(clip => clip.layer.assetId));
		worker.postMessage({
			type: 'start', assets: project.assets.filter(asset => assetIds.has(asset.id)), clips,
			sampleRate: this.rate, startFrame: this.startFrame, endFrame: this.endFrame,
		});
		// 最大1秒を先読みする。消費したチャンク分だけ補充し、長さに比例してメモリを使わない。
		for (let i = 0; i < 4; i++) worker.postMessage({ type: 'pull' });
		node.connect(output);
	}

	currentTime(): number {
		if (!this.context || this.clocks.length === 0) return this.requestedTime;
		const timestamp = this.context.getOutputTimestamp();
		const audibleFrame = (timestamp.contextTime ?? this.context.currentTime - this.context.outputLatency) * this.rate;
		const clock = this.clocks.findLast(clock => clock.contextFrame <= audibleFrame);
		if (!clock) return this.requestedTime;
		this.buffering.value = !clock.running || this.context.state !== 'running';
		const played = clock.playedFrames + (clock.running ? Math.max(0, audibleFrame - clock.contextFrame) : 0);
		return ((this.startFrame + played) % this.endFrame) * 1000 / this.rate;
	}

	stop() {
		this.generation++;
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
		}
		this.worker?.terminate();
		this.worker = null;
		if (this.node) {
			this.node.port.onmessage = null;
			this.node.port.postMessage({ type: 'dispose' });
			this.node.port.close();
			this.node.disconnect();
			this.node.onprocessorerror = null;
			this.node = null;
		}
		this.clocks = [];
		this.context = null;
		this.buffering.value = false;
	}
}
