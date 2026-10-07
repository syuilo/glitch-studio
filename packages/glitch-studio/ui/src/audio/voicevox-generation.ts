import { ref } from 'vue';
import { getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getVoicevoxRequests } from '@gs/subsystems_timeline_shared/voicevox-requests.ts';
import { GeneratedSpeechCache } from './generated-speech-cache.ts';
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

/** 生成は再生から独立し、内容キーとプロジェクト世代で古い結果の混入を防ぐ。 */
export class VoicevoxGeneration {
	readonly statuses = ref<Record<string, GenerationState>>({});
	private epoch = 0;
	private pending = new Map<string, GenerationJob>();
	private queue: GenerationJob[] = [];
	private running = false;
	private exportRequests = new Map<string, number>();
	private cache: GeneratedSpeechCache;
	private timer: ReturnType<typeof globalThis.setTimeout> | undefined;

	constructor(private options: {
		getScenes(): readonly TimelineScene[];
		getSpeech(): readonly GeneratedSpeech[];
		setSpeech(speech: GeneratedSpeech[]): void;
		synthesize(request: VoicevoxRequest): Promise<GeneratedSpeech>;
		cacheLimits?: { maxBytes?: number; maxEntries?: number };
	}) {
		this.cache = new GeneratedSpeechCache(options.cacheLimits);
	}

	reset() {
		this.epoch++;
		globalThis.clearTimeout(this.timer);
		for (const job of this.queue) job.completion.reject(new Error('Project changed'));
		this.queue = [];
		this.pending.clear();
		this.exportRequests.clear();
		this.cache.clear();
		this.statuses.value = {};
	}

	schedule() {
		globalThis.clearTimeout(this.timer);
		this.synchronizeSpeech();
		// デバウンス期間中も古い文章を待たせない。実行中の合成はqueueから外れているので維持する。
		this.discardUnusedRequests();
		this.timer = globalThis.setTimeout(() => {
			for (const request of getVoicevoxRequests(this.options.getScenes())) void this.enqueue(request, false, false).catch(() => {});
		}, 400);
	}

	generate(request: VoicevoxRequest, force = false): Promise<GeneratedSpeech> {
		return this.enqueue(request, force, true);
	}

	/** Web版でもUndo時に呼び、再合成できなくても保存済み音声を復元できるようにする。 */
	synchronizeSpeech() {
		const current = new Set(getVoicevoxRequests(this.options.getScenes()).map(getVoicevoxRequestKey));
		const previous = this.options.getSpeech();
		const active = previous.filter(speech => current.has(speech.key));
		const available = new Set(active.map(speech => speech.key));
		// 現在必要な結果を先に取り出す。旧結果の格納でUndo先が押し出されないようにする。
		for (const key of current) {
			if (available.has(key)) continue;
			const speech = this.cache.take(key);
			if (speech) {
				active.push(speech);
				if (!this.pending.has(key)) this.statuses.value[key] = { state: 'ready' };
			}
		}
		for (const speech of previous) if (!current.has(speech.key)) this.cache.set(speech);
		if (active.length !== previous.length || active.some((speech, index) => speech !== previous[index])) this.options.setSpeech(active);
		this.pruneStatuses(current);
	}

	private findSpeech(key: string): GeneratedSpeech | undefined {
		return this.options.getSpeech().find(speech => speech.key === key) ?? this.cache.get(key);
	}

	private pruneStatuses(current = new Set(getVoicevoxRequests(this.options.getScenes()).map(getVoicevoxRequestKey))) {
		for (const key of Object.keys(this.statuses.value)) {
			if (!current.has(key) && !this.cache.has(key) && !this.exportRequests.has(key) && !this.pending.has(key)) delete this.statuses.value[key];
		}
	}

	private enqueue(request: VoicevoxRequest, force: boolean, manual: boolean): Promise<GeneratedSpeech> {
		this.synchronizeSpeech();
		const key = getVoicevoxRequestKey(request);
		const existing = this.findSpeech(key);
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
					this.synchronizeSpeech();
					if (getVoicevoxRequests(this.options.getScenes()).some(request => getVoicevoxRequestKey(request) === job.key)) {
						this.cache.take(job.key);
						this.options.setSpeech([...this.options.getSpeech().filter(item => item.key !== job.key), speech]);
					} else {
						// 実行中だった旧本文もUndoには再利用できるが、プロジェクト保存には混ぜない。
						this.cache.set(speech);
					}
					this.statuses.value[job.key] = { state: 'ready' };
					job.completion.resolve(speech);
				} catch (error: unknown) {
					if (job.epoch === this.epoch) this.statuses.value[job.key] = { state: 'error', message: error instanceof Error ? error.message : String(error) };
					job.completion.reject(error);
				} finally {
					if (this.pending.get(job.key) === job) this.pending.delete(job.key);
					this.pruneStatuses();
				}
			}
		} finally { this.running = false; }
	}

	async prepare(requests: readonly VoicevoxRequest[], signal: AbortSignal): Promise<GeneratedSpeech[]> {
		const epoch = this.epoch;
		signal.throwIfAborted();
		// 先頭を待っている間も、後続の発話を編集中の自動生成の整理から保護する。
		// 同じ要求を複数の書き出しが待てるため、最後の利用者が終了するまで保持する。
		const uniqueRequests = new Map(requests.map(request => [getVoicevoxRequestKey(request), request]));
		const prepared = new Map<string, GeneratedSpeech>();
		for (const key of uniqueRequests.keys()) {
			this.exportRequests.set(key, (this.exportRequests.get(key) ?? 0) + 1);
			const speech = this.findSpeech(key);
			if (speech) prepared.set(key, speech);
		}
		let abort: () => void = () => {};
		try {
			// 既存の結果を予約してから編集状態を整理し、必要な音声をLRUへ移す途中でも失わない。
			this.synchronizeSpeech();
			const aborted = new Promise<never>((_resolve, reject) => {
				abort = () => reject(signal.reason);
				signal.addEventListener('abort', abort, { once: true });
			});
			// 全要求のPromiseを先に取得する。直列合成の途中で別の編集が結果をLRUから除去しても、
			// この書き出しが各結果を保持する。結果保持用の共有Mapを追加せず、書き出しごとに独立させる。
			const speech = await Promise.race([Promise.all([...uniqueRequests].map(([key, request]) => prepared.get(key) ?? this.enqueue(request, false, false))), aborted]);
			signal.throwIfAborted();
			if (epoch !== this.epoch) throw new Error('Project changed');
			// 呼び出し側が書き出し終了まで所有する。以後の編集やLRU削除で参照を失わない。
			return speech;
		} finally {
			signal.removeEventListener('abort', abort);
			// 別プロジェクトの同一キーの予約を、旧プロジェクトの完了処理で減らさない。
			if (epoch === this.epoch) {
				for (const key of uniqueRequests.keys()) {
					const remaining = this.exportRequests.get(key)! - 1;
					if (remaining > 0) this.exportRequests.set(key, remaining);
					else this.exportRequests.delete(key);
				}
				this.discardUnusedRequests();
				this.pruneStatuses();
			}
		}
	}
}
