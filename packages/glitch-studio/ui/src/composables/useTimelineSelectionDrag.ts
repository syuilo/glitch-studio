import { readonly, ref } from 'vue';
import { genId } from '@gs/shared/utility/id.js';
import type { Ref } from 'vue';
import type { TimelineInteraction } from './useTimelineInteraction.ts';
import type { TimelineViewport } from './useTimelineViewport.ts';
import type { TimelineMovePoint } from '@/utility/timeline-selection.ts';
import type { TimelineSnapSettings } from '@/utility/timeline-snapping.ts';
import { constrainTimelineMove, getTimelineSnappingTimes } from '@/utility/timeline-selection.ts';
import { getTimelineSnapCandidates, getTimelineSeekPosition } from '@/utility/timeline-snapping.ts';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';

type TimelineSelectionDragOptions = {
	timelineElement: Readonly<Ref<HTMLElement | null>>;
	layersElement: Readonly<Ref<HTMLElement | null>>;
	viewport: Pick<TimelineViewport, 'width' | 'rangeX' | 'panning' | 'pixelsPerMs' | 'timeAtClientX' | 'ticksWithMinor'>;
	interaction: TimelineInteraction;
	duration: Readonly<Ref<number>>;
	snapSettings: Readonly<Ref<TimelineSnapSettings>>;
	snapSeekBar: Readonly<Ref<boolean>>;
	seek: (timeMs: number) => void;
};

/** ポインターの進行と表示用の状態を所有し、対象ごとの制約・Command生成は呼び出し側へ委ねる。 */
export function useTimelineSelectionDrag(options: TimelineSelectionDragOptions) {
	const { viewport, interaction } = options;
	const movingSelection = ref(false);
	const snappingTimes = ref<number[]>([]);

	function canStart(event: PointerEvent): boolean {
		return event.button === 0 && event.isPrimary && !interaction.active.value && !viewport.panning.value
			&& options.timelineElement.value != null && viewport.width.value > 0 && viewport.rangeX.value > 0;
	}

	function startSelectionMove(event: PointerEvent, points: TimelineMovePoint[], snapTimes: number[], apply: (delta: number, mergeKey: string) => boolean,
		getSnapLines = (delta: number) => getTimelineSnappingTimes(points, snapTimes, delta)) {
		const timeline = options.timelineElement.value;
		const originTime = viewport.timeAtClientX(event.clientX);
		if (!canStart(event) || points.length === 0 || timeline == null || originTime == null) return;
		const release = interaction.begin(() => stopPointer());
		if (!release) return;
		event.preventDefault();
		timeline.focus({ preventScroll: true });
		const mergeKey = genId();
		let moved = false;
		let previousDelta = 0;
		const stopPointer = listenPointerDrag(event, current => {
			if (!moved && Math.abs(current.clientX - event.clientX) < 3) return;
			moved = true;
			movingSelection.value = true;
			interaction.suppressNextClick();
			// ドラッグ中にズームしても、開始時の画素倍率ではなく現在の時刻座標で追従する。
			const msPerPixel = 1 / viewport.pixelsPerMs.value;
			const pointerTime = viewport.timeAtClientX(current.clientX);
			if (pointerTime == null) return;
			const result = constrainTimelineMove(pointerTime - originTime, points, snapTimes, msPerPixel);
			snappingTimes.value = getSnapLines(result.delta);
			if (result.delta === previousDelta) return;
			if (!apply(result.delta, mergeKey)) { stopPointer?.(); return; }
			previousDelta = result.delta;
		}, () => {
			snappingTimes.value = [];
			movingSelection.value = false;
			release();
		}, options.layersElement.value ?? timeline);
	}

	function onSeekBarPointerDown(event: PointerEvent) {
		if (!canStart(event)) return;
		const release = interaction.begin(() => stopPointer());
		if (!release) return;
		event.preventDefault();
		event.stopPropagation();
		const stopPointer = listenPointerDrag(event, current => {
			const pointerTime = viewport.timeAtClientX(current.clientX);
			if (pointerTime == null) return;
			const candidates = options.snapSeekBar.value ? getTimelineSnapCandidates(options.snapSettings.value, [], viewport.ticksWithMinor.value) : [];
			const result = getTimelineSeekPosition(Math.round(pointerTime), options.duration.value, candidates, 1 / viewport.pixelsPerMs.value);
			snappingTimes.value = result.snappingTime == null ? [] : [result.snappingTime];
			options.seek(result.timeMs);
		}, () => {
			snappingTimes.value = [];
			release();
		});
	}

	return { canStart, startSelectionMove, onSeekBarPointerDown, movingSelection: readonly(movingSelection), snappingTimes: readonly(snappingTimes) };
}

export type TimelineSelectionDrag = ReturnType<typeof useTimelineSelectionDrag>;
