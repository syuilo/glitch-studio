import { watchEffect } from 'vue';
import type { Ref } from 'vue';

type CanvasName = 'canvas' | 'histogramCanvas' | 'waveformHorizontalCanvas' | 'waveformVerticalCanvas';
type CanvasSource = Record<CanvasName, HTMLCanvasElement> & { canvasRevision: Ref<number> };

/** モード変更・Worker再生成・表示先の移動で、現在のCanvasを付け直す。 */
export function useRendererCanvas(container: Readonly<Ref<HTMLElement | null>>, source: Readonly<Ref<CanvasSource>>, getName: () => CanvasName) {
	watchEffect(onCleanup => {
		const target = container.value;
		const renderer = source.value;
		// Controller自体はmarkRawなので、Canvasの交換を明示的に監視する。
		renderer.canvasRevision.value;
		const canvas = renderer[getName()];
		if (target == null) return;
		target.appendChild(canvas);
		onCleanup(() => {
			// 別ウィンドウなどへ移動済みの場合、その所有者の表示を取り除かない。
			if (canvas.parentNode === target) target.removeChild(canvas);
		});
	}, { flush: 'post' });
}
