import { ref } from 'vue';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { VoicevoxRequest } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';

type GenerationState = { state: 'generating' | 'ready' | 'error'; message?: string };
type GenerationJob = {
	key: string;
	request: VoicevoxRequest;
	epoch: number;
	manual: boolean;
	completion: PromiseWithResolvers<GeneratedSpeech>;
};

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
	private pending = new Map<string, GenerationJob>();
	private queue: GenerationJob[] = [];
	private running = false;
	private exportRequests = new Map<string, number>();
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
		for (const job of this.queue) job.completion.reject(new Error('Project changed'));
		this.queue = [];
		this.pending.clear();
		this.exportRequests.clear();
		this.statuses.value = {};
	}

	schedule() {
		globalThis.clearTimeout(this.timer);
		// デバウンス期間中も古い文章を待たせない。実行中の合成はqueueから外れているので維持する。
		this.discardUnusedRequests();
		this.timer = globalThis.setTimeout(() => {
			for (const request of getVoicevoxRequests(this.options.getScenes())) void this.enqueue(request, false, false).catch(() => {});
		}, 400);
	}

	generate(request: VoicevoxRequest, force = false): Promise<GeneratedSpeech> {
		return this.enqueue(request, force, true);
	}

	private enqueue(request: VoicevoxRequest, force: boolean, manual: boolean): Promise<GeneratedSpeech> {
		const key = getVoicevoxRequestKey(request);
		const existing = this.options.getSpeech().find(speech => speech.key === key);
		if (existing && !force) return Promise.resolve(existing);
		const pending = this.pending.get(key);
		if (pending) {
			pending.manual ||= manual;
			return pending.completion.promise;
		}
		const job: GenerationJob = { key, request, epoch: this.epoch, manual, completion: Promise.withResolvers<GeneratedSpeech>() };
		this.pending.set(key, job);
		this.statuses.value[key] = { state: 'generating' };
		this.queue.push(job);
		void this.runQueue();
		return job.completion.promise;
	}

	private discardUnusedRequests() {
		const current = new Set(getVoicevoxRequests(this.options.getScenes()).map(getVoicevoxRequestKey));
		this.queue = this.queue.filter(job => {
			if (job.manual || this.exportRequests.has(job.key) || current.has(job.key)) return true;
			this.pending.delete(job.key);
			delete this.statuses.value[job.key];
			// 自動生成の取消しはエンジンのエラーとして表示しない。再び必要になれば新規に積める。
			job.completion.reject(new Error('Speech request is no longer needed'));
			return false;
		});
	}

	private async runQueue() {
		if (this.running) return;
		this.running = true;
		try {
			while (this.queue.length > 0) {
				// 変更通知がデバウンス中でも、現在の発話・書き出し要求に不要な合成は開始しない。
				this.discardUnusedRequests();
				const job = this.queue.shift();
				if (!job) break;
				try {
					const speech = await this.options.synthesize(job.request);
					if (job.epoch !== this.epoch) throw new Error('Project changed');
					// 実行中だった旧本文は完了させ、同じプロジェクトのUndoや別発話へ再利用する。
					this.options.setSpeech([...this.options.getSpeech().filter(item => item.key !== job.key), speech]);
					this.statuses.value[job.key] = { state: 'ready' };
					job.completion.resolve(speech);
				} catch (error: unknown) {
					if (job.epoch === this.epoch) this.statuses.value[job.key] = { state: 'error', message: error instanceof Error ? error.message : String(error) };
					job.completion.reject(error);
				} finally { if (this.pending.get(job.key) === job) this.pending.delete(job.key); }
			}
		} finally { this.running = false; }
	}

	async prepare(requests: readonly VoicevoxRequest[], signal: AbortSignal) {
		const epoch = this.epoch;
		signal.throwIfAborted();
		// 先頭を待っている間も、後続の発話を編集中の自動生成の整理から保護する。
		// 同じ要求を複数の書き出しが待てるため、最後の利用者が終了するまで保持する。
		const keys = new Set(requests.map(getVoicevoxRequestKey));
		for (const key of keys) this.exportRequests.set(key, (this.exportRequests.get(key) ?? 0) + 1);
		try {
			for (const request of requests) {
				signal.throwIfAborted();
				if (epoch !== this.epoch) throw new Error('Project changed');
				let abort: () => void = () => {};
				try {
					await Promise.race([this.enqueue(request, false, false), new Promise<never>((_resolve, reject) => {
						abort = () => reject(signal.reason);
						signal.addEventListener('abort', abort, { once: true });
					})]);
				} finally { signal.removeEventListener('abort', abort); }
			}
			signal.throwIfAborted();
			if (epoch !== this.epoch) throw new Error('Project changed');
		} finally {
			// 別プロジェクトの同一キーの予約を、旧プロジェクトの完了処理で減らさない。
			if (epoch === this.epoch) {
				for (const key of keys) {
					const remaining = this.exportRequests.get(key)! - 1;
					if (remaining > 0) this.exportRequests.set(key, remaining);
					else this.exportRequests.delete(key);
				}
				this.discardUnusedRequests();
			}
		}
	}
}
