import { readonly, ref, watch } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Ref } from 'vue';
import type { TimelineInteraction } from './useTimelineInteraction.ts';
import type { TimelineViewport } from './useTimelineViewport.ts';
import type { TimelineMarqueeAnchor, TimelineLayerSelectionLayout, TimelineMarqueeLayer } from '@/utility/timeline-marquee.ts';
import type { TimelineSelection, SelectionRect } from '@/utility/timeline-selection.ts';
import type { VirtualScrollItemLayout, VirtualScrollLayout } from '@/utility/virtual-scroll.ts';
import { collectTimelineMarqueeCandidates, measureTimelineLayerSelection } from '@/utility/timeline-marquee.ts';
import { selectionRect, mergeTimelineRangeSelection } from '@/utility/timeline-selection.ts';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';

type TimelineMarqueeSelectionOptions = {
	sceneId: () => string;
	timelineElement: Readonly<Ref<HTMLElement | null>>;
	layersElement: Readonly<Ref<HTMLElement | null>>;
	virtualLayers: Readonly<Ref<{
		refresh(): Promise<void>;
		getClientTop(): number;
		getItemAt(y: number): VirtualScrollItemLayout | undefined;
		getLayout(): VirtualScrollLayout;
	} | null>>;
	viewport: Pick<TimelineViewport, 'positionX' | 'rangeX' | 'width' | 'height' | 'panning'>;
	interaction: TimelineInteraction;
	layers: Readonly<Ref<readonly TimelineMarqueeLayer[]>>;
	layerSizeKeys: Readonly<Ref<ReadonlyMap<string, string>>>;
	rulerHeight: number;
	selection: Ref<TimelineSelection>;
	revealDetails: () => void;
};

/** 仮想一覧の境界計測と選択確定を管理する。最後の非同期計測が終わるまで操作を保持する。 */
export function useTimelineMarqueeSelection(options: TimelineMarqueeSelectionOptions) {
	const { timelineElement, layersElement, virtualLayers, viewport, interaction,
		layers: marqueeLayers, layerSizeKeys, rulerHeight, selection, revealDetails } = options;
	const { positionX, rangeX, width, height } = viewport;
	const selectionArea = ref<SelectionRect | null>(null);
	let updateMarquee: (() => void) | undefined;

	function onVirtualLayersLayout() { updateMarquee?.(); }

	function onBackgroundPointerDown(event: PointerEvent) {
		interaction.resetClickSuppression();
		if (event.button !== 0 || !event.isPrimary || interaction.active.value || viewport.panning.value || timelineElement.value == null || layersElement.value == null || virtualLayers.value == null || !(event.target instanceof Element)) return;
		const timeline = timelineElement.value;
		const layers = layersElement.value;
		const virtual = virtualLayers.value;
		const target = event.target;
		if (!layers.contains(target) && !timeline.contains(target)) return;
		if (target.closest('[data-timeline-clip-id], [data-timeline-keyframe-id], button, input, select, textarea, [draggable="true"]')) return;
		const bounds = timeline.getBoundingClientRect();
		if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top + rulerHeight || event.clientY > bounds.bottom) return;
		const releaseInteraction = interaction.begin(() => cancel());
		if (!releaseInteraction) return;
		const release = releaseInteraction;
		event.preventDefault();
		event.stopPropagation();
		timeline.focus({ preventScroll: true });
		const previous = deepClone(selection.value);
		// ドラッグ開始を待たずに背景を押した時点で解除する。Shiftでの追加選択は維持する。
		if (!event.shiftKey) selection.value = { kind: 'layers', ids: [] };
		const originX = event.clientX - bounds.left;
		const initialY = event.clientY;
		let origin: TimelineMarqueeAnchor | undefined;
		let pointer = { x: event.clientX, y: event.clientY };
		const boundaryLayouts = new Map<string, TimelineLayerSelectionLayout>();
		let active = true;
		let finishing = false;
		let revision = 0;
		let pending: Promise<void> | undefined;

		function anchorAt(clientY: number): TimelineMarqueeAnchor | undefined {
			const y = clientY - virtual.getClientTop();
			const item = virtual.getItemAt(y);
			return item ? { layerId: String(item.key), offsetY: y - item.top } : undefined;
		}

		function measureBoundary(anchor: TimelineMarqueeAnchor): boolean {
			if (boundaryLayouts.has(anchor.layerId)) return true;
			const element = [...layers.querySelectorAll<HTMLElement>('[data-timeline-layer-id]')].find(element => element.dataset.timelineLayerId === anchor.layerId);
			if (!element) return false;
			const measured = measureTimelineLayerSelection(element);
			if (!measured) return false;
			boundaryLayouts.set(anchor.layerId, measured);
			return true;
		}

		// 開始時の行内位置を先に確保し、後続の実測による上方の高さ補正に影響されないようにする。
		const initialLayer = target.closest<HTMLElement>('[data-timeline-layer-id]');
		origin = initialLayer?.dataset.timelineLayerId
			? { layerId: initialLayer.dataset.timelineLayerId, offsetY: initialY - initialLayer.getBoundingClientRect().top }
			: anchorAt(initialY);
		if (origin && !measureBoundary(origin)) origin = undefined;

		function scheduleUpdate() {
			if (!active) return;
			revision++;
			if (pending) return;
			pending = (async () => {
				let processed = -1;
				while (active && processed !== revision) {
					processed = revision;
					// スクロールイベント時点では、新しい境界行のDOMがまだ存在しない場合がある。
					// 推定値で確定せず、仮想一覧が実測まで終えた後に判定する。
					await virtual.refresh();
					if (!active) break;
					const bounds = timeline.getBoundingClientRect();
					const endY = Math.max(bounds.top + rulerHeight, Math.min(bounds.bottom, pointer.y));
					origin ??= anchorAt(initialY);
					const end = anchorAt(endY);
					if (!origin || !end || !measureBoundary(origin) || !measureBoundary(end)) continue;
					const originItem = virtual.getLayout().byKey.get(origin.layerId);
					if (!originItem) continue;
					const originY = virtual.getClientTop() + originItem.top + origin.offsetY;
					const endX = Math.max(0, Math.min(width.value, pointer.x - bounds.left));
					const rect = selectionRect(originX, originY - bounds.top, endX, endY - bounds.top);
					if (!selectionArea.value && Math.hypot(rect.right - rect.left, rect.bottom - rect.top) < 3) continue;
					interaction.suppressNextClick();
					selectionArea.value = rect;
					const candidates = collectTimelineMarqueeCandidates(marqueeLayers.value, origin, end, boundaryLayouts, {
						left: rect.left, right: rect.right, position: positionX.value, range: rangeX.value, width: width.value,
					});
					selection.value = mergeTimelineRangeSelection(candidates.clips, candidates.keyframes, previous, event.shiftKey);
					// 開始行と現在の境界以外のレーン座標は不要。高速スクロールでもメモリを増やさない。
					for (const id of boundaryLayouts.keys()) if (id !== origin.layerId && id !== end.layerId) boundaryLayouts.delete(id);
				}
			})().finally(() => { pending = undefined; if (finishing) cleanup(); });
		}

		function cleanup() {
			const reveal = active && finishing && selectionArea.value != null;
			active = false;
			layers.removeEventListener('scroll', scheduleUpdate);
			stopWatch();
			stopHorizontalWatch();
			// キャンセル後に次の操作が始まっていても、古い非同期計測の完了で消さない。
			if (updateMarquee === scheduleUpdate) {
				updateMarquee = undefined;
				selectionArea.value = null;
				release();
				// 範囲選択中の展開はタイムラインの寸法を変えるため、確定後に一度だけ開く。
				if (reveal) revealDetails();
			}
		}

		// レーン構成や並び順が変わる操作では古い行内計測を使わない。横ズームは再計算で追従する。
		const stopWatch = watch([
			options.sceneId,
			() => JSON.stringify([...layerSizeKeys.value]),
			width,
			height,
		], cancel, { flush: 'sync' });
		const stopHorizontalWatch = watch([positionX, rangeX], scheduleUpdate);
		updateMarquee = scheduleUpdate;
		layers.addEventListener('scroll', scheduleUpdate, { passive: true });
		// 背景クリックは子レーンのダブルクリック追加へ届かせ、範囲選択の開始後だけ一覧で捕捉する。
		const stopPointer = listenPointerDrag(event, current => {
			pointer = { x: current.clientX, y: current.clientY };
			scheduleUpdate();
		}, () => {
			// pointerupで予約した最後の判定を待つ。行を破棄してもCaptureは一覧要素に残る。
			finishing = true;
			if (!pending) cleanup();
		}, layers, { captureAfterDistance: 3 });

		function cancel() { active = false; stopPointer(); cleanup(); }

		scheduleUpdate();
	}

	return { selectionArea: readonly(selectionArea), onBackgroundPointerDown, onVirtualLayersLayout };
}
