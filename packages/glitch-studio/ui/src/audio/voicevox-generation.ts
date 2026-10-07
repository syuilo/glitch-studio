import { ref } from 'vue';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { VoicevoxRequest } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';

type GenerationState = { state: 'generating' | 'ready' | 'error'; message?: string };

export function getVoicevoxRequests(scenes: readonly TimelineScene[]): VoicevoxRequest[] {
	return scenes.flatMap(scene => scene.layers.flatMap(layer => layer.layerType === 'voicevox'
		? layer.utterances.filter(utterance => utterance.text !== '').map(utterance => getVoicevoxRequest(layer.voicevox, utterance)) : []));
}

/** 書き出し範囲に交差する発話だけを列挙する。未生成の長さは次のキー・クリップまでとする。 */
export function getRequiredVoicevoxRequests(scenes: readonly TimelineScene[], sceneId: string, startMs: number, endMs: number): VoicevoxRequest[] {
	const requests = new Map<string, VoicevoxRequest>();
	const clips = getSceneAudioClips(scenes, sceneId, { type: 'all' }, request => {
		const key = getVoicevoxRequestKey(request);
		requests.set(key, request);
		return { key, sourceId: key, durationMs: Infinity };
	});
	const required = new Set(clips.filter(clip => clip.startMs < endMs && clip.endMs > startMs).map(clip => clip.sourceId));
	return [...requests].filter(([key]) => required.has(key)).map(([, request]) => request);
}

/** 生成は再生から独立し、内容キーとプロジェクト世代で古い結果の混入を防ぐ。 */
export class VoicevoxGeneration {
	readonly statuses = ref<Record<string, GenerationState>>({});
	private epoch = 0;
	private pending = new Map<string, Promise<GeneratedSpeech>>();
	private queue: Promise<unknown> = Promise.resolve();
	private timer: ReturnType<typeof globalThis.setTimeout> | undefined;

	constructor(private options: {
		getScenes(): readonly TimelineScene[];
		getSpeech(): readonly GeneratedSpeech[];
		setSpeech(speech: GeneratedSpeech[]): void;
		synthesize(request: VoicevoxRequest): Promise<GeneratedSpeech>;
	}) {}

	reset() {
		this.epoch++;
		globalThis.clearTimeout(this.timer);
		this.pending.clear();
		this.statuses.value = {};
	}

	schedule() {
		globalThis.clearTimeout(this.timer);
		this.timer = globalThis.setTimeout(() => {
			for (const request of getVoicevoxRequests(this.options.getScenes())) void this.generate(request).catch(() => {});
		}, 400);
	}

	generate(request: VoicevoxRequest, force = false): Promise<GeneratedSpeech> {
		const key = getVoicevoxRequestKey(request);
		const existing = this.options.getSpeech().find(speech => speech.key === key);
		if (existing && !force) return Promise.resolve(existing);
		const pending = this.pending.get(key);
		if (pending) return pending;
		const epoch = this.epoch;
		this.statuses.value[key] = { state: 'generating' };
		const result = this.queue.then(async () => {
			if (epoch !== this.epoch) throw new Error('Project changed');
			const speech = await this.options.synthesize(request);
			if (epoch !== this.epoch) throw new Error('Project changed');
			// 旧本文の音声が完成しても、新本文には別のキーを使うため採用されない。
			// Undoで戻った際の再利用に備え、同じプロジェクトの結果は保持する。
			this.options.setSpeech([...this.options.getSpeech().filter(item => item.key !== key), speech]);
			this.statuses.value[key] = { state: 'ready' };
			return speech;
		}).catch((error: unknown) => {
			if (epoch === this.epoch) this.statuses.value[key] = { state: 'error', message: error instanceof Error ? error.message : String(error) };
			throw error;
		}).finally(() => { if (this.pending.get(key) === result) this.pending.delete(key); });
		this.pending.set(key, result);
		this.queue = result.catch(() => {});
		return result;
	}

	async prepare(requests: readonly VoicevoxRequest[], signal: AbortSignal) {
		const epoch = this.epoch;
		for (const request of requests) {
			signal.throwIfAborted();
			if (epoch !== this.epoch) throw new Error('Project changed');
			// 書き出しの取消しは直ちに返す。共有した生成自体は止めず、他の利用者へ残す。
			let abort: () => void = () => {};
			try {
				await Promise.race([this.generate(request), new Promise<never>((_resolve, reject) => {
					abort = () => reject(signal.reason);
					signal.addEventListener('abort', abort, { once: true });
				})]);
			} finally { signal.removeEventListener('abort', abort); }
		}
		signal.throwIfAborted();
		if (epoch !== this.epoch) throw new Error('Project changed');
	}
}
