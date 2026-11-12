import { buildMandelbrotReferenceOrbit } from './reference-orbit.ts';
import type { MandelbrotReferenceOrbit } from './reference-orbit.ts';
import type { MandelbrotReferenceRequest } from './mandelbrot-settings.ts';
import type { EffectStatus } from '../../effect-status.ts';

export function createMandelbrotReferenceLoader(options: {
	publish: (orbit: MandelbrotReferenceOrbit) => void;
	reportStatus: (status: EffectStatus) => void;
	build?: typeof buildMandelbrotReferenceOrbit;
}) {
	let currentKey: string | null = null;
	let ready = false;
	let disposed = false;
	let revision = 0;
	let controller: AbortController | null = null;
	let removeAbortListener: (() => void) | null = null;
	// シークで直前の表示範囲へ戻る場合も、同じ入力・精度で計算した軌道だけを再利用する。
	const cache = new Map<string, MandelbrotReferenceOrbit>();

	return {
		get cacheVersion() { return revision; },
		get ready() { return ready; },
		prepare(request: MandelbrotReferenceRequest, signal?: AbortSignal) {
			if (disposed || signal?.aborted === true) return;
			const key = JSON.stringify(request);
			const changed = currentKey !== key || controller?.signal.aborted === true;
			// renderから同じ要求を確認するだけなら、prepareで受け取った中断通知を保持する。
			if (changed || signal != null) { removeAbortListener?.(); removeAbortListener = null; }
			if (changed) {
				controller?.abort();
				controller = null;
				currentKey = key;
				ready = false;
				const cached = cache.get(key);
				if (cached != null) {
					cache.delete(key);
					cache.set(key, cached);
					options.publish(cached);
					ready = true;
					++revision;
					options.reportStatus({ type: 'ready' });
				} else {
					const pending = new AbortController();
					controller = pending;
					options.reportStatus({ type: 'loading' });
					void (options.build ?? buildMandelbrotReferenceOrbit)(request, pending.signal).then(orbit => {
						if (disposed || controller !== pending || pending.signal.aborted) return;
						options.publish(orbit);
						cache.set(key, orbit);
						if (cache.size > 2) {
							const oldestKey = cache.keys().next().value;
							if (oldestKey != null) cache.delete(oldestKey);
						}
						ready = true;
						controller = null;
						removeAbortListener?.();
						removeAbortListener = null;
						++revision;
						options.reportStatus({ type: 'ready' });
					}).catch(error => {
						if (disposed || controller !== pending || pending.signal.aborted) return;
						controller = null;
						removeAbortListener?.();
						removeAbortListener = null;
						options.reportStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) });
					});
				}
			}
			if (controller != null && signal != null) {
				const pending = controller;
				const cancel = () => {
					pending.abort();
					if (controller === pending) { currentKey = null; ready = false; }
				};
				signal.addEventListener('abort', cancel, { once: true });
				removeAbortListener = () => signal.removeEventListener('abort', cancel);
			}
		},
		dispose() {
			disposed = true;
			ready = false;
			removeAbortListener?.();
			controller?.abort();
			cache.clear();
		},
	};
}
