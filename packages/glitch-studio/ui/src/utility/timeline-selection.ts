import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { TimelineParameterTarget } from './timeline-scene.ts';

// 発話キーはUIの選択対象として扱うが、パラメータBindingには変換しない。
export type TimelineKeyTarget = TimelineParameterTarget | 'utterance';

export type TimelineKeyframeSelection = {
	layerId: string;
	target: TimelineKeyTarget;
	paramPath: ParamPath;
	keyframeId: string;
};

export type TimelineKeyframePosition = TimelineKeyframeSelection & { x: number };

export type TimelineSelection =
	| { kind: 'layers'; ids: string[] }
	| { kind: 'clips'; clips: TimelineClipSelection[] }
	| { kind: 'keyframes'; keyframes: TimelineKeyframeSelection[] };

export type TimelineClipSelection = { layerId: string; clipId: string };

export function selectTimelineLayer(previous: TimelineSelection, visibleLayerIds: readonly string[], layerId: string, anchorId: string | null, modifiers: { range: boolean; additive: boolean }): { selection: Extract<TimelineSelection, { kind: 'layers' }>; anchorId: string | null } {
	const ids = previous.kind === 'layers' ? previous.ids : [];
	if (modifiers.range) {
		const anchor = anchorId != null && ids.includes(anchorId) && visibleLayerIds.includes(anchorId)
			? anchorId : ids.find(id => visibleLayerIds.includes(id)) ?? layerId;
		const start = visibleLayerIds.indexOf(anchor);
		const end = visibleLayerIds.indexOf(layerId);
		// 仮想スクロールで画面外にある行も含め、折りたたまれた子は含めない。
		// Shift操作中は起点を固定し、終点を戻すことで選択範囲を縮められるようにする。
		const range = start >= 0 && end >= 0 ? visibleLayerIds.slice(Math.min(start, end), Math.max(start, end) + 1) : [layerId];
		return { selection: { kind: 'layers', ids: modifiers.additive ? [...new Set([...ids, ...range])] : range }, anchorId: anchor };
	}
	if (modifiers.additive) {
		const next = ids.includes(layerId) ? ids.filter(id => id !== layerId) : [...ids, layerId];
		return { selection: { kind: 'layers', ids: next }, anchorId: next.includes(layerId) ? layerId : next.at(-1) ?? null };
	}
	return { selection: { kind: 'layers', ids: [layerId] }, anchorId: layerId };
}

export function clipSelectionKey(selection: TimelineClipSelection): string {
	return JSON.stringify([selection.layerId, selection.clipId]);
}

export type SelectionRect = { left: number; top: number; right: number; bottom: number };
export type TimelineSelectionGeometry = {
	clips: { selection: TimelineClipSelection; rect: SelectionRect }[];
	keyframes: { selection: TimelineKeyframeSelection; x: number; y: number }[];
};

export function keyframeSelectionKey(selection: TimelineKeyframeSelection): string {
	return JSON.stringify([selection.layerId, selection.target, selection.paramPath, selection.keyframeId]);
}

export function getTimelineStretchSelection(keyframes: readonly TimelineKeyframeSelection[], selection: TimelineSelection, dragged: TimelineKeyframeSelection): TimelineKeyframeSelection[] {
	const selected = new Set((selection.kind === 'keyframes' ? selection.keyframes : [])
		.filter(point => point.layerId === dragged.layerId).map(keyframeSelectionKey));
	// 部分選択がある場合は未選択キーを巻き込まない。選択なしで端点を操作するときだけレーン全体を扱う。
	return keyframes.filter(point => point.layerId === dragged.layerId && (selected.size > 0
		? selected.has(keyframeSelectionKey(point))
		: point.target === dragged.target && paramPathKey(point.paramPath) === paramPathKey(dragged.paramPath)));
}

export function selectionRect(x1: number, y1: number, x2: number, y2: number): SelectionRect {
	return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

export function timelineMarqueeRect(origin: { x: number; y: number }, pointer: { x: number; y: number }, viewport: SelectionRect, scrollTop: number): SelectionRect {
	// 開始点はスクロール領域内に固定し、終点は現在のポインター位置に置く。
	// 開始点まで表示領域にクランプすると、スクロールで画面外へ出た対象が選択から抜けてしまう。
	return selectionRect(viewport.left + origin.x, viewport.top + origin.y - scrollTop,
		Math.max(viewport.left, Math.min(viewport.right, pointer.x)), Math.max(viewport.top, Math.min(viewport.bottom, pointer.y)));
}

export function selectTimelineRange(rect: SelectionRect, geometry: TimelineSelectionGeometry, previous: TimelineSelection, additive: boolean): TimelineSelection {
	const clips = geometry.clips.filter(clip => clip.rect.left <= rect.right && clip.rect.right >= rect.left
		&& clip.rect.top <= rect.bottom && clip.rect.bottom >= rect.top).map(clip => clip.selection);
	const keyframes = geometry.keyframes.filter(point => point.x >= rect.left && point.x <= rect.right
		&& point.y >= rect.top && point.y <= rect.bottom).map(point => point.selection);
	return mergeTimelineRangeSelection(clips, keyframes, previous, additive);
}

export function mergeTimelineRangeSelection(clips: TimelineClipSelection[], keyframes: TimelineKeyframeSelection[], previous: TimelineSelection, additive: boolean): TimelineSelection {
	const hasPrevious = previous.kind === 'layers' ? previous.ids.length > 0 : previous.kind === 'clips' ? previous.clips.length > 0 : previous.keyframes.length > 0;
	// Shiftで追加する間は既存の種類を固定する。囲む途中で別の種類へ切り替わると、
	// 追加したかったキーがクリップとの交差によって失われてしまうため。
	const kind = additive && hasPrevious ? previous.kind : clips.length > 0 ? 'clips' : 'keyframes';
	if (kind === 'layers') return previous;
	if (kind === 'clips') return { kind, clips: [...new Map([...(additive && previous.kind === kind ? previous.clips : []), ...clips]
		.map(clip => [clipSelectionKey(clip), clip])).values()] };
	return { kind, keyframes: [...new Map([...(additive && previous.kind === kind ? previous.keyframes : []), ...keyframes]
		.map(point => [keyframeSelectionKey(point), point])).values()] };
}

export type TimelineMovePoint = {
	time: number;
	minDelta: number;
	maxDelta: number;
	/** 指定時は共通候補を置き換える。別レイヤーのローカル目盛りへ吸着させないため。 */
	snapTimes?: number[];
};

export function constrainTimelineMove(rawDelta: number, points: TimelineMovePoint[], snapTimes: number[], msPerPixel: number): { delta: number; snappingTime: number | null } {
	const minDelta = Math.ceil(Math.max(...points.map(point => point.minDelta)));
	const maxDelta = Math.floor(Math.min(...points.map(point => point.maxDelta)));
	let delta = Math.max(minDelta, Math.min(maxDelta, Math.round(rawDelta)));
	let snappingTime: number | null = null;
	let nearestDistance = 5;
	// 各要素を個別にクランプせず、共通の移動量を制限して相対位置を守る。
	for (const point of points) {
		for (const time of point.snapTimes ?? snapTimes) {
			// 素材の小数オフセット由来の目盛りにも、最寄りの整数msで吸着する。
			const candidateDelta = Math.round(time) - point.time;
			if (candidateDelta < minDelta || candidateDelta > maxDelta) continue;
			const distance = Math.abs(candidateDelta - rawDelta) / msPerPixel;
			if (distance >= nearestDistance) continue;
			nearestDistance = distance;
			delta = candidateDelta;
			snappingTime = point.time + candidateDelta;
		}
	}
	return { delta, snappingTime };
}

export function getTimelineSnappingTimes(points: TimelineMovePoint[], snapTimes: number[], delta: number): number[] {
	// 表示する線にも各点の候補を使う。別レイヤーの目盛りとの偶然の一致は表示しない。
	// 保存される整数msの位置と線を一致させ、元の小数目盛りに線だけ残さない。
	return [...new Set(points.flatMap(point => (point.snapTimes ?? snapTimes).map(Math.round).filter(time => point.time + delta === time)))];
}

export function keyframeMoveBounds(keyframes: readonly { id: string; x: number }[], selectedIds: ReadonlySet<string>, keyframeId: string): { minDelta: number; maxDelta: number } {
	const sorted = keyframes.toSorted((a, b) => a.x - b.x);
	const index = sorted.findIndex(point => point.id === keyframeId);
	const point = sorted[index];
	const previous = sorted.slice(0, index).findLast(entry => !selectedIds.has(entry.id));
	const next = sorted.slice(index + 1).find(entry => !selectedIds.has(entry.id));
	// 既存の短い間隔を操作開始時に広げると、触れただけでキーが飛んでしまう。
	// 100ms未満なら元の間隔を下限にし、同じ操作の往復でも開始位置まで戻せるようにする。
	return {
		minDelta: Math.max(0, previous ? previous.x + Math.min(100, point.x - previous.x) : 0) - point.x,
		maxDelta: (next ? next.x - Math.min(100, next.x - point.x) : Infinity) - point.x,
	};
}
