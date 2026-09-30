export type KeyframeStretch = {
	anchorX: number;
	endpointX: number;
	minDelta: number;
	maxDelta: number;
};

export function createKeyframeStretch(keyframes: readonly { id: string; x: number }[], keyframeId: string): KeyframeStretch | null {
	const endpoint = keyframes.find(point => point.id === keyframeId);
	if (endpoint == null || keyframes.length < 2) return null;
	const firstX = Math.min(...keyframes.map(point => point.x));
	const lastX = Math.max(...keyframes.map(point => point.x));
	if (firstX === lastX || (endpoint.x !== firstX && endpoint.x !== lastX)) return null;
	const anchorX = endpoint.x === firstX ? lastX : firstX;
	// 全キーが重なると次の操作で比率を復元できなくなるため、最低1msの幅を残す。
	// 元々1ms未満のデータは操作開始時に広げず、その幅を下限にする。
	const minimumSpan = Math.min(1, lastX - firstX);
	return {
		anchorX, endpointX: endpoint.x,
		minDelta: endpoint.x === firstX ? -firstX : firstX + minimumSpan - lastX,
		maxDelta: endpoint.x === firstX ? lastX - minimumSpan - firstX : Infinity,
	};
}

export function stretchKeyframeX(x: number, stretch: KeyframeStretch, delta: number): number {
	const endpointX = stretch.endpointX + Math.max(stretch.minDelta, Math.min(stretch.maxDelta, delta));
	if (x === stretch.endpointX) return endpointX;
	// 毎回ドラッグ開始時の時刻から計算し、往復操作による丸め誤差の蓄積を防ぐ。
	const ratio = (x - stretch.anchorX) / (stretch.endpointX - stretch.anchorX);
	return stretch.anchorX + (endpointX - stretch.anchorX) * ratio;
}
