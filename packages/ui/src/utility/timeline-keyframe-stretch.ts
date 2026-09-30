export type KeyframeStretch = {
	anchorX: number;
	endpointX: number;
	minDelta: number;
	maxDelta: number;
};

export function createKeyframeStretch(keyframes: readonly { id: string; x: number }[], keyframeId: string, affectedKeyframes: readonly { x: number; minDelta?: number; maxDelta?: number }[] = keyframes): KeyframeStretch | null {
	const endpoint = keyframes.find(point => point.id === keyframeId);
	if (endpoint == null || keyframes.length < 2) return null;
	const firstX = Math.min(...keyframes.map(point => point.x));
	const lastX = Math.max(...keyframes.map(point => point.x));
	if (firstX === lastX || (endpoint.x !== firstX && endpoint.x !== lastX)) return null;
	const anchorX = endpoint.x === firstX ? lastX : firstX;
	// 全キーが重なると次の操作で比率を復元できなくなるため、最低1msの幅を残す。
	// 元々1ms未満のデータは操作開始時に広げず、その幅を下限にする。
	const minimumSpan = Math.min(1, lastX - firstX);
	const stretch = {
		anchorX, endpointX: endpoint.x,
		minDelta: endpoint.x === firstX ? -firstX : firstX + minimumSpan - lastX,
		maxDelta: endpoint.x === firstX ? lastX - minimumSpan - firstX : Infinity,
	};
	// 別レーンにはドラッグ元の端点より外側のキーもあり得る。
	// x' = x + ratio * delta が各キーの移動可能範囲に収まる共通範囲を求める。
	// 部分選択では未選択の隣接キーも境界になる。個別に丸めず、全体の比率を保ったまま制限する。
	for (const point of affectedKeyframes) {
		const ratio = (point.x - anchorX) / (endpoint.x - anchorX);
		const minDelta = Math.max(-point.x, point.minDelta ?? -point.x);
		const maxDelta = point.maxDelta ?? Infinity;
		if (ratio > 0) {
			stretch.minDelta = Math.max(stretch.minDelta, minDelta / ratio);
			stretch.maxDelta = Math.min(stretch.maxDelta, maxDelta / ratio);
		} else if (ratio < 0) {
			stretch.minDelta = Math.max(stretch.minDelta, maxDelta / ratio);
			stretch.maxDelta = Math.min(stretch.maxDelta, minDelta / ratio);
		}
	}
	return stretch;
}

export function stretchKeyframeX(x: number, stretch: KeyframeStretch, delta: number): number {
	const boundedDelta = Math.max(stretch.minDelta, Math.min(stretch.maxDelta, delta));
	// 毎回ドラッグ開始時の時刻から計算し、往復操作による丸め誤差の蓄積を防ぐ。
	const ratio = (x - stretch.anchorX) / (stretch.endpointX - stretch.anchorX);
	// 共通範囲の境界で発生する浮動小数点誤差だけを0へ補正する。
	return Math.max(0, x + boundedDelta * ratio);
}
