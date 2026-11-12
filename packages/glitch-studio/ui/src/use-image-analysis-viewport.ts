import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import { startPreviewPointerDrag } from './utility/preview-pointer-drag.ts';
import { panImageAnalysisViewport, zoomImageAnalysisViewport } from './utility/image-analysis-viewport.ts';
import type { Ref } from 'vue';
import type { PreviewImageAnalysisViewport } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';

export function useImageAnalysisViewport(element: Readonly<Ref<HTMLElement | null>>, viewport: Readonly<Ref<PreviewImageAnalysisViewport>>,
	update: (viewport: PreviewImageAnalysisViewport) => void, flush: () => void, suspended: Readonly<Ref<boolean>>, axes: 'both' | 'x' = 'both') {
	const horizontalOnly = axes === 'x';
	const panning = ref(false);
	const zoom = computed(() => 1 / Math.min(viewport.value.width, viewport.value.height));
	let stopPan: (() => void) | null = null;
	const cancelPan = () => stopPan?.();
	// ヒストグラムの縦軸は自動スケールを維持し、波形と同じ操作のうちX軸だけを適用する。
	const updateViewport = (next: PreviewImageAnalysisViewport) => update(horizontalOnly ? { ...next, y: 0, height: 1 } : next);

	function reset() {
		cancelPan();
		updateViewport({ ...FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT });
		flush();
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const target = element.value;
		if (target == null || suspended.value || panning.value || target.clientWidth <= 0 || target.clientHeight <= 0) return;
		const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1);
		if (!Number.isFinite(pixels) || pixels === 0) return;
		const rect = target.getBoundingClientRect();
		updateViewport(zoomImageAnalysisViewport(viewport.value, {
			x: (event.clientX - rect.left - target.clientLeft) / target.clientWidth,
			y: (event.clientY - rect.top - target.clientTop) / target.clientHeight,
		}, 2 ** (-Math.max(-600, Math.min(600, pixels)) / 600)));
	}

	function onPointerdown(event: PointerEvent) {
		const target = element.value;
		if (target == null || suspended.value || stopPan != null || event.isPrimary === false || (event.button !== 0 && event.button !== 1)) return;
		if (viewport.value.width === 1 && viewport.value.height === 1) return;
		const initial = { ...viewport.value };
		const size = { width: target.clientWidth, height: target.clientHeight };
		panning.value = true;
		stopPan = startPreviewPointerDrag(event, {
			move: next => updateViewport(panImageAnalysisViewport(initial, { x: next.clientX - event.clientX, y: next.clientY - event.clientY }, size)),
			end: cancelled => {
				if (cancelled) updateViewport(initial);
				panning.value = false;
				stopPan = null;
				flush();
			},
		});
	}

	function onKeydown(event: KeyboardEvent) {
		if (suspended.value || panning.value) return;
		const target = element.value;
		if (event.key === 'Home' || event.key === '0') {
			event.preventDefault(); reset();
		} else if (['+', '=', '-'].includes(event.key)) {
			event.preventDefault();
			updateViewport(zoomImageAnalysisViewport(viewport.value, { x: 0.5, y: 0.5 }, event.key === '-' ? 1 / 1.2 : 1.2));
			flush();
		} else if (target != null && (horizontalOnly ? ['ArrowLeft', 'ArrowRight'] : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']).includes(event.key)) {
			event.preventDefault();
			updateViewport(panImageAnalysisViewport(viewport.value, {
				x: event.key === 'ArrowLeft' ? target.clientWidth / 10 : event.key === 'ArrowRight' ? -target.clientWidth / 10 : 0,
				y: event.key === 'ArrowUp' ? target.clientHeight / 10 : event.key === 'ArrowDown' ? -target.clientHeight / 10 : 0,
			}, { width: target.clientWidth, height: target.clientHeight }));
			flush();
		}
	}

	watch(suspended, paused => { if (paused) cancelPan(); }, { flush: 'sync' });
	onBeforeUnmount(cancelPan);
	return { panning, zoom, reset, cancelPan, onWheel, onPointerdown, onKeydown };
}
