import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { PreviewOptions } from './audio/audio-preview-types.ts';
import { appContext } from './app.ts';

export function useAudioPreview(canvas: Readonly<Ref<HTMLCanvasElement | null>>, options: Readonly<Ref<PreviewOptions>>) {
	const { audioOutput } = appContext;
	const error = ref('');
	let panel: ReturnType<typeof audioOutput.preview.add> | null = null;
	let releaseCapture: (() => void) | null = null;
	let observer: ResizeObserver | null = null;
	let intersection: IntersectionObserver | null = null;
	let doc: Document | null = null;
	let viewWindow: Window | null = null;
	let density: MediaQueryList | null = null;
	let intersecting = true;

	function resize() {
		const element = canvas.value;
		if (!element || !panel) return;
		const { width, height } = element.getBoundingClientRect();
		panel.resize({
			width,
			height,
			ratio: viewWindow?.devicePixelRatio ?? 1,
			visible: !doc?.hidden && intersecting && element.getClientRects().length > 0,
		});
	}

	function watchDensity() {
		density?.removeEventListener('change', watchDensity);
		density = viewWindow?.matchMedia(`(resolution: ${viewWindow.devicePixelRatio}dppx)`) ?? null;
		density?.addEventListener('change', watchDensity);
		resize();
	}

	function changeWindow() {
		doc?.removeEventListener('visibilitychange', resize);
		viewWindow?.removeEventListener('resize', resize);
		doc = canvas.value?.ownerDocument ?? null;
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
		panel = null;
		releaseCapture?.();
		releaseCapture = null;
		observer?.disconnect();
		intersection?.disconnect();
		doc?.removeEventListener('visibilitychange', resize);
		viewWindow?.removeEventListener('resize', resize);
		density?.removeEventListener('change', watchDensity);
	}

	onMounted(() => {
		try {
			panel = audioOutput.preview.add(canvas.value!, options.value, message => { error.value = message; stop(); });
			releaseCapture = audioOutput.retainOutputCapture();
			observer = new ResizeObserver(resize);
			observer.observe(canvas.value!);
			changeWindow();
		} catch (reason) { error.value = String(reason); stop(); }
	});
	watch(options, value => panel?.configure(value), { deep: true });
	onBeforeUnmount(stop);
	return { changeWindow, error, sampleRate: audioOutput.preview.sampleRate };
}
