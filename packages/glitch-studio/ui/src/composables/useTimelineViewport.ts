import { computed, onMounted, onScopeDispose, readonly, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { TimelineTickMode, TimelineTickSubdivisions } from '@/utility/timeline-ticks.ts';
import { timelineTimeToX, timelinePointerTime } from '@/utility/timeline-coordinates.ts';
import { getTimelineTickCount, getTimelineTicks, getTimelineMinorTicks } from '@/utility/timeline-ticks.ts';
import { zoomTimelineX } from '@/utility/timeline-zoom.ts';
import { dragListen } from '@/utility/drag.ts';

export type TimelineViewport = ReturnType<typeof useTimelineViewport>;

type TimelineViewportOptions = {
	timelineElement: Readonly<Ref<HTMLElement | null>>;
	layersElement: Readonly<Ref<HTMLElement | null>>;
	savedState: { positionX: number; rangeX: number };
	currentTime: Readonly<Ref<number>>;
	isPlaying: Readonly<Ref<boolean>>;
	followPlayhead: Readonly<Ref<boolean>>;
	tickMode: Readonly<Ref<TimelineTickMode>>;
	tickSubdivisions: Readonly<Ref<TimelineTickSubdivisions>>;
	interactionActive: Readonly<Ref<boolean>>;
};

/** タイムラインの表示範囲を所有する。選択・シーク操作の内容やプロジェクトの変更は扱わない。 */
export function useTimelineViewport(options: TimelineViewportOptions) {
	const positionX = ref(options.savedState.positionX);
	const rangeX = ref(options.savedState.rangeX);
	const width = ref(0);
	const height = ref(0);
	const panning = ref(false);
	const pixelsPerMs = computed(() => width.value / rangeX.value);
	// 連続的に横移動する間だけ描画の準備を促し、停止後はリソースを解放できるようにする。
	const optimizeHorizontalMovement = computed(() => (options.isPlaying.value && options.followPlayhead.value) || panning.value);

	// レイヤー名を除いた実測幅で密度を選ぶ。全体・ローカル・スナップが同じ目盛りを使う。
	const tickCount = computed(() => getTimelineTickCount(width.value));
	const ticks = computed(() => getTimelineTicks(positionX.value, rangeX.value, tickCount.value, options.tickMode.value));
	const minorTicks = computed(() => getTimelineMinorTicks(ticks.value, options.tickSubdivisions.value));
	const ticksWithMinor = computed(() => [...ticks.value, ...minorTicks.value].toSorted((a, b) => a - b));

	function timeToX(time: number): number {
		return timelineTimeToX(time, positionX.value, rangeX.value, width.value);
	}

	// 座標変換では小数msを保つ。キー配置・シークなどの整数化は操作側で行う。
	function timeAtX(x: number): number {
		return timelinePointerTime(x, 0, positionX.value, pixelsPerMs.value);
	}

	function timeAtClientX(clientX: number): number | null {
		const element = options.timelineElement.value;
		if (element == null || width.value <= 0 || rangeX.value <= 0) return null;
		return timelinePointerTime(clientX, element.getBoundingClientRect().left, positionX.value, pixelsPerMs.value);
	}

	function onTimelineWheel(event: WheelEvent) {
		if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-timeline-surface]')) return;
		// レイヤーやキーの上でも同じ操作にし、通常のスクロール・背景ズームとの二重処理を防ぐ。
		onRulerWheel(event);
	}

	function onBackgroundWheel(event: WheelEvent) {
		const element = options.timelineElement.value;
		if (element == null || width.value <= 0) return;
		event.preventDefault();
		const x = event.clientX - element.getBoundingClientRect().left;
		const anchorTime = timeAtX(x);
		// 背景ホイールの既存の倍率を維持し、カーソル直下の時刻を同じ画面位置に留める。
		rangeX.value *= 1 + (event.deltaY / 1000);
		positionX.value = anchorTime - x / pixelsPerMs.value;
	}

	function onRulerWheel(event: WheelEvent) {
		const element = options.timelineElement.value;
		if (element == null || width.value <= 0) return;
		event.preventDefault();
		event.stopPropagation();
		const x = event.clientX - element.getBoundingClientRect().left;
		// ShiftでdeltaXへ変換される環境と、行・ページ単位で届くホイールにも対応する。
		const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width.value : 1;
		const delta = (event.deltaY || event.deltaX) * unit;
		const viewport = zoomTimelineX(positionX.value, rangeX.value, Math.max(0, Math.min(1, x / width.value)), delta);
		rangeX.value = viewport.range;
		positionX.value = viewport.start;
	}

	let stopPan: (() => void) | undefined;

	function finishPan() {
		stopPan?.();
	}

	function onPanAuxclick(event: MouseEvent) {
		if (event.button !== 1 || !(event.target instanceof Element) || !event.target.closest('[data-timeline-surface]')) return;
		event.preventDefault();
		event.stopPropagation();
	}

	function onPanMousedown(event: MouseEvent) {
		if (options.interactionActive.value) return;
		if (event.button !== 1 || !(event.target instanceof Element) || !event.target.closest('[data-timeline-surface]')) return;
		const layers = options.layersElement.value;
		if (layers == null || width.value <= 0) return;
		// パネルを別ウィンドウで開いた場合も、開始時のウィンドウ内で移動・終了を追跡する。
		const ownerWindow = layers.ownerDocument.defaultView;
		if (ownerWindow == null) return;
		// 子のレイヤー・キー・シーク操作より先に受け取り、ブラウザーの自動スクロールも抑止する。
		event.preventDefault();
		event.stopPropagation();
		finishPan();
		options.timelineElement.value?.focus({ preventScroll: true });
		const baseX = event.clientX;
		const baseY = event.clientY;
		const baseTime = positionX.value;
		const baseScrollTop = layers.scrollTop;
		const msPerPixel = rangeX.value / width.value;
		panning.value = true;
		stopPan = dragListen(current => {
			if ((current.buttons & 4) === 0) { finishPan(); return; }
			positionX.value = baseTime - (current.clientX - baseX) * msPerPixel;
			// 縦方向は値の座標系ではなく、レイヤー一覧の実際のスクロール位置を動かす。
			layers.scrollTop = baseScrollTop - (current.clientY - baseY);
		}, () => {
			panning.value = false;
			stopPan = undefined;
			ownerWindow.removeEventListener('blur', finishPan);
			ownerWindow.removeEventListener('pagehide', finishPan);
		}, ownerWindow);
		ownerWindow.addEventListener('blur', finishPan);
		ownerWindow.addEventListener('pagehide', finishPan);
	}

	watch([options.currentTime, options.isPlaying, options.followPlayhead, rangeX, width, panning, options.interactionActive], () => {
		if (!options.followPlayhead.value || !options.isPlaying.value || panning.value || options.interactionActive.value || width.value <= 0 || rangeX.value <= 0) return;
		// 開始判定中のドラッグや範囲選択・シークでも基準座標を固定するため、操作側の状態を受け取る。
		positionX.value = options.currentTime.value - rangeX.value / 2;
	}, { immediate: true });

	let resizeObserver: ResizeObserver | undefined;
	onMounted(() => {
		const element = options.timelineElement.value;
		if (element == null) return;
		const measure = () => {
			width.value = element.offsetWidth;
			height.value = element.offsetHeight;
		};
		measure();
		resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(element);
	});

	onScopeDispose(() => {
		finishPan();
		resizeObserver?.disconnect();
		// 親のonBeforeUnmountでCUEの一時的な表示位置が戻された後に保存する。
		// onUnmountedまで遅らせず、同じSceneの次のsetupが保存済みの位置を読めるようにする。
		options.savedState.rangeX = rangeX.value;
		options.savedState.positionX = positionX.value;
	});

	return {
		positionX, rangeX, width: readonly(width), height: readonly(height), pixelsPerMs,
		panning: readonly(panning), optimizeHorizontalMovement,
		tickCount, ticks, minorTicks, ticksWithMinor,
		timeToX, timeAtX, timeAtClientX,
		onTimelineWheel, onBackgroundWheel, onRulerWheel, onPanMousedown, onPanAuxclick,
	};
}
