import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { Resolution } from '@gs/shared/resolution.ts';

/** 表示先のCSS寸法とDPRを監視する。転送済みのCanvas属性はWorkerだけが変更する。 */
export function useWaveformCanvasSize(element: Readonly<Ref<HTMLElement | null>>, update: (size: Resolution) => void) {
	const size = shallowRef<Resolution>({ width: 0, height: 0 });
	let observer: ResizeObserver | null = null;
	let view: (Window & typeof globalThis) | null = null;
	let density: MediaQueryList | null = null;
	let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
	let pending: Resolution | null = null;
	let applied: Resolution | null = null;
	let stopped = false;
	let generation = 0;

	function schedule() {
		if (stopped || view == null || size.value.width <= 0 || size.value.height <= 0) return;
		const ratio = view.devicePixelRatio;
		const next = { width: Math.max(1, Math.round(size.value.width * ratio)), height: Math.max(1, Math.round(size.value.height * ratio)) };
		pending = next;
		if (timer != null || (applied?.width === next.width && applied.height === next.height)) return;
		// リサイズ中にGPU要求を毎イベント送らず、最後の寸法も含め100msごとに最新値を渡す。
		timer = globalThis.setTimeout(() => {
			timer = null;
			const latest = pending;
			pending = null;
			if (latest == null || (applied?.width === latest.width && applied.height === latest.height)) return;
			applied = latest;
			update(latest);
		}, 100);
	}

	function measure() {
		if (element.value == null) return;
		size.value = { width: element.value.clientWidth, height: element.value.clientHeight };
		schedule();
	}

	function watchDensity() {
		density?.removeEventListener('change', watchDensity);
		density = view?.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`) ?? null;
		density?.addEventListener('change', watchDensity);
		schedule();
	}

	function stop() {
		generation++;
		observer?.disconnect();
		view?.removeEventListener('resize', measure);
		density?.removeEventListener('change', watchDensity);
		if (timer != null) globalThis.clearTimeout(timer);
		timer = null;
		pending = null;
	}

	function changeWindow() {
		if (stopped) return;
		stop();
		const target = element.value;
		view = target?.ownerDocument.defaultView ?? null;
		if (target == null || view == null) return;
		const observedGeneration = generation;
		observer = new view.ResizeObserver(([entry]) => {
			if (observedGeneration !== generation) return;
			size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
			schedule();
		});
		observer.observe(target);
		view.addEventListener('resize', measure);
		measure();
		watchDensity();
	}

	onMounted(changeWindow);
	// 子の別ウィンドウが破棄中にchangeWindowを通知しても、監視を復活させない。
	onBeforeUnmount(() => { stopped = true; stop(); });
	return { size, changeWindow };
}
