import type { AudioInput, AudioWindow } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { EffectStatus } from './effect-status.ts';

/** 描画を進めず音声だけ準備する。古いシークの完了は次の窓や状態を上書きしない。 */
export function createAudioWindowLoader(reportStatus: (status: EffectStatus) => void) {
	let controller: AbortController | undefined;
	let requestKey: string | undefined;
	let requestSignal: AbortSignal | undefined;
	let window: AudioWindow | null = null;
	let revision = 0;
	return {
		get window() { return window; },
		get revision() { return revision; },
		prepare(input: AudioInput | null, duration: number, signal?: AbortSignal) {
			const key = JSON.stringify([input?.cacheKey ?? null, duration]);
			if (key === requestKey && !requestSignal?.aborted) return;
			controller?.abort();
			controller = new AbortController();
			const current = controller;
			requestSignal = signal ? AbortSignal.any([signal, current.signal]) : current.signal;
			const currentSignal = requestSignal;
			requestKey = key;
			window = null;
			revision++;
			if (input == null) { reportStatus({ type: 'ready' }); return; }
			reportStatus({ type: 'loading' });
			const accept = (result: AudioWindow) => {
				if (currentSignal.aborted || controller !== current) return;
				window = result;
				revision++;
				reportStatus({ type: 'ready' });
			};
			const fail = (error: unknown) => {
				if (currentSignal.aborted || controller !== current) return;
				requestKey = undefined;
				reportStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			};
			try {
				const result = input.readWindow(duration, currentSignal);
				if (result instanceof Promise) void result.then(accept).catch(fail);
				else accept(result);
			} catch (error) { fail(error); }
		},
		dispose() { controller?.abort(); window = null; },
	};
}
