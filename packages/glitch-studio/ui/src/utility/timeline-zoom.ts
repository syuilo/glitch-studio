export function zoomTimelineX(start: number, range: number, anchorRatio: number, wheelDelta: number): { start: number; range: number } {
	// 指数倍率ならホイール量が大きくても範囲が負にならず、逆向きの操作で元の倍率に戻せる。
	const nextRange = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, range * Math.exp(wheelDelta / 1000)));
	return { start: start + (range - nextRange) * anchorRatio, range: nextRange };
}
