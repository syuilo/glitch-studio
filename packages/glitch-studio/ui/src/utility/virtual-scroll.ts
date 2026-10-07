export type VirtualScrollKey = string | number;
export type VirtualScrollItemLayout = { key: VirtualScrollKey; index: number; top: number; height: number };
export type VirtualScrollLayout = { items: VirtualScrollItemLayout[]; byKey: Map<VirtualScrollKey, VirtualScrollItemLayout>; height: number };

export function createVirtualScrollLayout(keys: readonly VirtualScrollKey[], heights: ReadonlyMap<VirtualScrollKey, number>, estimatedHeight: number, gap: number): VirtualScrollLayout {
	let top = 0;
	const items = keys.map((key, index) => {
		const height = heights.get(key) ?? estimatedHeight;
		const item = { key, index, top, height };
		top += height + gap;
		return item;
	});
	return { items, byKey: new Map(items.map(item => [item.key, item])), height: Math.max(0, top - gap) };
}

/** 行間は直前の行に属する。前後の余白も端の行からの相対位置として表せる。 */
export function findVirtualScrollItem(layout: VirtualScrollLayout, y: number): VirtualScrollItemLayout | undefined {
	let low = 0;
	let high = layout.items.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (layout.items[middle].top <= y) low = middle + 1;
		else high = middle;
	}
	return layout.items[Math.max(0, low - 1)];
}

/** 可視範囲外で操作中の行だけも保持し、間の全行をマウントすることは避ける。 */
export function getVirtualScrollItems(layout: VirtualScrollLayout, top: number, bottom: number, retainedKeys: readonly VirtualScrollKey[]): VirtualScrollItemLayout[] {
	const first = findVirtualScrollItem(layout, top);
	const last = findVirtualScrollItem(layout, bottom);
	const indices = new Set<number>();
	if (first && last && bottom >= 0 && top <= layout.height) {
		for (let index = first.index; index <= last.index; index++) indices.add(index);
	}
	for (const key of retainedKeys) {
		const item = layout.byKey.get(key);
		if (item) indices.add(item.index);
	}
	return [...indices].sort((a, b) => a - b).map(index => layout.items[index]);
}

/** 削除時は元の位置に近い残存行へ引き継ぎ、並べ替えでは同じキーを追う。 */
export function getVirtualScrollAnchorOffset(previous: VirtualScrollLayout, next: VirtualScrollLayout, y: number): number {
	const anchor = findVirtualScrollItem(previous, y);
	if (!anchor || y <= 0) return y;
	const replacement = next.byKey.get(anchor.key) ?? next.items[Math.min(anchor.index, next.items.length - 1)];
	if (!replacement) return 0;
	const offset = y - anchor.top;
	// 行間や一覧末尾の余白を、行内へ勝手にクランプすると計測のたびに数pxずつ跳ねる。
	return replacement.top + (offset <= anchor.height ? Math.min(offset, replacement.height) : replacement.height + offset - anchor.height);
}
