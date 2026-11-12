import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import { startPreviewPointerDrag } from './utility/preview-pointer-drag.ts';
import { panImageAnalysisViewport, selectImageAnalysisViewport, zoomImageAnalysisViewport } from './utility/image-analysis-viewport.ts';
import type { Ref } from 'vue';
import type { PreviewImageAnalysisViewport } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';

export function useImageAnalysisViewport(element: Readonly<Ref<HTMLElement | null>>, viewport: Readonly<Ref<PreviewImageAnalysisViewport>>,
	update: (viewport: PreviewImageAnalysisViewport) => void, flush: () => void, suspended: Readonly<Ref<boolean>>,
	options: { axes?: 'both' | 'x'; displayedViewport?: Readonly<Ref<PreviewImageAnalysisViewport>> } = {}) {
	const horizontalOnly = options.axes === 'x';
	const displayedViewport = options.displayedViewport ?? viewport;
	const panning = ref(false);
	const selection = shallowRef<PreviewImageAnalysisViewport | null>(null);
	const zoom = computed(() => 1 / Math.min(viewport.value.width, viewport.value.height));
	let stopInteraction: (() => void) | null = null;
	const cancelInteraction = () => stopInteraction?.();
	// ヒストグラムの縦軸は自動スケールを維持し、波形と同じ操作のうちX軸だけを適用する。
	const updateViewport = (next: PreviewImageAnalysisViewport) => update(horizontalOnly ? { ...next, y: 0, height: 1 } : next);

	function reset() {
		cancelInteraction();
		updateViewport({ ...FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT });
		flush();
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const target = element.value;
		if (target == null || suspended.value || stopInteraction != null || target.clientWidth <= 0 || target.clientHeight <= 0) return;
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
		if (target == null || suspended.value || stopInteraction != null || event.isPrimary === false || (event.button !== 0 && event.button !== 1)
			|| target.clientWidth <= 0 || target.clientHeight <= 0) return;
		target.focus({ preventScroll: true });
		if (event.button === 0) {
			startSelection(event, target);
			return;
		}
		// 全体表示でパンできない場合も、中クリックのブラウザー自動スクロールを起動しない。
		event.preventDefault();
		if (viewport.value.width === 1 && viewport.value.height === 1) return;
		const initial = { ...viewport.value };
		const size = { width: target.clientWidth, height: target.clientHeight };
		panning.value = true;
		stopInteraction = startPreviewPointerDrag(event, {
			move: next => updateViewport(panImageAnalysisViewport(initial, { x: next.clientX - event.clientX, y: next.clientY - event.clientY }, size)),
			end: cancelled => {
				if (cancelled) updateViewport(initial);
				panning.value = false;
				stopInteraction = null;
				flush();
			},
		});
	}

	function startSelection(event: PointerEvent, target: HTMLElement) {
		const size = { width: target.clientWidth, height: target.clientHeight };
		const bounds = target.getBoundingClientRect();
		const position = (next: PointerEvent) => ({
			x: Math.max(0, Math.min(1, (next.clientX - bounds.left - target.clientLeft) / size.width)),
			y: Math.max(0, Math.min(1, (next.clientY - bounds.top - target.clientTop) / size.height)),
		});
		const start = position(event);
		stopInteraction = startPreviewPointerDrag(event, {
			move: next => {
				const end = position(next);
				selection.value = {
					x: Math.min(start.x, end.x), y: horizontalOnly ? 0 : Math.min(start.y, end.y),
					width: Math.abs(end.x - start.x), height: horizontalOnly ? 1 : Math.abs(end.y - start.y),
				};
			},
			end: cancelled => {
				const selected = selection.value;
				selection.value = null;
				stopInteraction = null;
				// クリックや細すぎる矩形は無視し、幅0の範囲や意図しない最大ズームを作らない。
				if (cancelled || selected == null || selected.width * size.width < 3 || (!horizontalOnly && selected.height * size.height < 3)) return;
				// 再解析待ちの要求値ではなく、離した時点で画面に見えている領域を基準にする。
				updateViewport(selectImageAnalysisViewport(displayedViewport.value, selected));
				flush();
			},
		});
	}

	function onKeydown(event: KeyboardEvent) {
		if (suspended.value || stopInteraction != null) return;
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

	watch(suspended, paused => { if (paused) cancelInteraction(); }, { flush: 'sync' });
	onBeforeUnmount(cancelInteraction);
	return { panning, selection, zoom, reset, cancelInteraction, onWheel, onPointerdown, onKeydown };
}
