import type { EffectFrameContext, EffectPreparationStatus } from './effect-instance.ts';

export type PrepareFrame = (frame: EffectFrameContext, signal: AbortSignal) => void | Promise<void>;

/** 同じEffectFrameContextを渡したプレビュー再試行と書き出しの待機で、評価値・音声入力を共有する。 */
export function createFramePreparation(steps: readonly PrepareFrame[], notify?: (status: EffectPreparationStatus) => void) {
	type Request = {
		source: EffectFrameContext;
		frame: EffectFrameContext;
		controller: AbortController;
		status: EffectPreparationStatus;
		completion: Promise<void> | null;
	};
	let current: Request | null = null;
	const running = new Set<Promise<void>>();

	function invalidate() {
		const previous = current;
		// abortで同期的に通知されても、古い要求から現在の準備状態を上書きできないようにする。
		current = null;
		previous?.controller.abort();
	}

	function start(source: EffectFrameContext): Request {
		if (current?.source === source) return current;
		invalidate();
		const controller = new AbortController();
		const frame = { ...source };
		const request: Request = { source, frame, controller, status: { type: 'ready' }, completion: null };
		current = request;
		const tasks: Promise<void>[] = [];

		function status(value: EffectPreparationStatus) {
			request.status = value;
			if (current === request) notify?.(value);
		}

		function fail(error: unknown) {
			status({ type: 'error', error });
			controller.abort(error);
		}

		try {
			for (const step of steps) {
				if (controller.signal.aborted) break;
				const task = step(frame, controller.signal);
				if (task != null) tasks.push(task);
			}
		} catch (error) { fail(error); }
		if (tasks.length === 0 && current === request && request.status.type === 'ready') notify?.(request.status);
		if (tasks.length > 0) {
			// 失敗はすぐに通知する。リソースの解放は、それを使う準備処理がすべて終わってから行う。
			const drained = Promise.allSettled(tasks).then(() => {});
			running.add(drained);
			void drained.then(() => running.delete(drained));
			if (request.status.type !== 'error') status({ type: 'loading' });
			request.completion = Promise.all(tasks).then(() => {
				if (!controller.signal.aborted) status({ type: 'ready' });
			}, error => { if (!controller.signal.aborted) fail(error); });
		}
		return request;
	}

	function ready(request: Request): boolean {
		if (request.status.type === 'error') throw request.status.error;
		request.controller.signal.throwIfAborted();
		return request.status.type === 'ready';
	}

	return {
		get status(): EffectPreparationStatus { return current?.status ?? { type: 'idle' }; },
		tryPrepare(frame: EffectFrameContext) { return ready(start(frame)); },
		async prepare(frame: EffectFrameContext, signal?: AbortSignal) {
			signal?.throwIfAborted();
			const request = start(frame);
			if (signal?.aborted === true) {
				if (current === request) invalidate();
				signal.throwIfAborted();
			}
			if (ready(request)) return;
			const abort = () => request.controller.abort(signal?.reason);
			const aborted = Promise.withResolvers<void>();
			const reject = () => aborted.reject(request.controller.signal.reason);
			request.controller.signal.addEventListener('abort', reject, { once: true });
			signal?.addEventListener('abort', abort, { once: true });
			try {
				request.controller.signal.throwIfAborted();
				await Promise.race([request.completion, aborted.promise]);
				request.controller.signal.throwIfAborted();
				ready(request);
			} finally {
				request.controller.signal.removeEventListener('abort', reject);
				signal?.removeEventListener('abort', abort);
				if (request.controller.signal.aborted && current === request && request.status.type !== 'error') invalidate();
			}
		},
		// 準備時と同じフレームを使い、描画時に式や入力を評価し直さずに済むようにする。
		take(frame: EffectFrameContext) {
			if (steps.length === 0 && current == null && notify == null) return frame;
			const request = start(frame);
			if (!ready(request)) throw new Error('Effect frame preparation is pending');
			current = null;
			return request.frame;
		},
		invalidate,
		afterPending(release: () => void) {
			if (running.size === 0) release();
			else void Promise.all(running).then(release);
		},
	};
}
