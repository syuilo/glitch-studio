import { shallowRef } from 'vue';
import type { Ref } from 'vue';

/** 波形・ヒストグラムの表示領域に対する位置を共有し、別ウィンドウの座標も正しく扱う。 */
export function useImageAnalysisPointer(element: Readonly<Ref<HTMLElement | null>>) {
	const pointerPosition = shallowRef<{ x: number; y: number } | null>(null);

	function clearPointerPosition() { pointerPosition.value = null; }

	function updatePointerPosition(event: PointerEvent) {
		const target = element.value;
		if (target == null || event.pointerType === 'touch' || target.clientWidth <= 0 || target.clientHeight <= 0) {
			clearPointerPosition();
			return;
		}
		const bounds = target.getBoundingClientRect();
		const x = (event.clientX - bounds.left - target.clientLeft) / target.clientWidth;
		const y = (event.clientY - bounds.top - target.clientTop) / target.clientHeight;
		// ドラッグ中はcaptureによって領域外でもmoveが届くため、座標でも表示の有無を判定する。
		pointerPosition.value = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
	}

	return { pointerPosition, clearPointerPosition, updatePointerPosition };
}
