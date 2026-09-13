import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { PreviewOptions } from './audio/audio-preview-types.ts';
import { engine } from './app.ts';

export function useAudioPreview(canvas: Readonly<Ref<HTMLCanvasElement | null>>, options: Readonly<Ref<PreviewOptions>>) {
	const error = ref('');
	let panel: ReturnType<typeof engine.audioPreview.add> | undefined;
	let releaseCapture: (() => void) | undefined;
	let observer: ResizeObserver | undefined;
	let intersection: IntersectionObserver | undefined;
	let doc: Document | undefined;
	let viewWindow: Window | null = null;
	let density: MediaQueryList | undefined;
	let intersecting = true;

	function resize() {
		const element = canvas.value;
		if (!element || !panel) return;
		const { width, height } = element.getBoundingClientRect();
		panel.resize({ width, height, ratio: viewWindow?.devicePixelRatio ?? 1,
			visible: !doc?.hidden && intersecting && element.getClientRects().length > 0 });
	}

	function watchDensity() {
		density?.removeEventListener('change', watchDensity);
		density = viewWindow?.matchMedia(`(resolution: ${viewWindow.devicePixelRatio}dppx)`);
		density?.addEventListener('change', watchDensity);
		resize();
	}

	function changeWindow() {
		doc?.removeEventListener('visibilitychange', resize);
		viewWindow?.removeEventListener('resize', resize);
		doc = canvas.value?.ownerDocument;
		viewWindow = doc?.defaultView ?? null;
		doc?.addEventListener('visibilitychange', resize);
		viewWindow?.addEventListener('resize', resize);
		intersection?.disconnect();
		intersecting = true;
		if (canvas.value) {
			intersection = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; resize(); }, { root: doc });
			intersection.observe(canvas.value);
		}
		watchDensity();
	}

	function stop() {
		panel?.dispose();
		panel = undefined;
		releaseCapture?.();
		releaseCapture = undefined;
		observer?.disconnect();
		intersection?.disconnect();
		doc?.removeEventListener('visibilitychange', resize);
		viewWindow?.removeEventListener('resize', resize);
		density?.removeEventListener('change', watchDensity);
	}

	onMounted(() => {
		try {
			panel = engine.audioPreview.add(canvas.value!, options.value, message => { error.value = message; stop(); });
			releaseCapture = engine.retainAudioOutputCapture();
			observer = new ResizeObserver(resize);
			observer.observe(canvas.value!);
			changeWindow();
		} catch (reason) { error.value = String(reason); stop(); }
	});
	watch(options, value => panel?.configure(value), { deep: true });
	onBeforeUnmount(stop);
	return { changeWindow, error, sampleRate: engine.audioPreview.sampleRate };
}
