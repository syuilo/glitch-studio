import type { ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';

export type ImageAnalysisAxisTick = {
	value: number;
	// 軸の表示方向に沿った位置。X軸は左から右、Y軸は上から下を0〜1とする。
	position: number;
	label: string;
	isReference: boolean;
};

export function createImagePositionAxisTicks(): ImageAnalysisAxisTick[] {
	return [0, 25, 50, 75, 100].map(value => ({
		value,
		position: value / 100,
		label: `${value}%`,
		isReference: false,
	}));
}

export function createImageValueAxisTicks(valueScale: ImageValueScale): ImageAnalysisAxisTick[] {
	const { values, minimum, maximum } = {
		srgb: { values: [0, 0.25, 0.5, 0.75, 1], minimum: 0, maximum: 1 },
		linearZeroToOne: { values: [0, 0.25, 0.5, 0.75, 1], minimum: 0, maximum: 1 },
		linearMinusOneToOne: { values: [-1, -0.5, 0, 0.5, 1], minimum: -1, maximum: 1 },
		linear: { values: [-1, 0, 1, 2, 3, 4], minimum: -1, maximum: 4 },
		ev: { values: [-10, -5, 0, 5, 10], minimum: -10, maximum: 10 },
	}[valueScale];

	// 値はすでに選択した軸の単位。sRGB値を再encodeしたり、EV値を再log変換したりしない。
	// 正規化は@gs/shared/gpu/image-value-scale.wgslの集計位置と一致させる。
	return values.map(value => ({
		value,
		position: (value - minimum) / (maximum - minimum),
		label: value < 0 ? `−${Math.abs(value)}` : valueScale === 'ev' && value > 0 ? `+${value}` : String(value),
		isReference: valueScale !== 'srgb' && value === 0,
	}));
}

/** グリッドとラベルを一緒に間引き、ラベルのない中間線が別の値を示すように見えるのを防ぐ。 */
export function selectImageAnalysisAxisTicks(ticks: readonly ImageAnalysisAxisTick[], extent: number, minimumSpacing: number): ImageAnalysisAxisTick[] {
	const selected = ticks.filter(tick => tick.position === 0 || tick.position === 1);
	// 範囲の両端を残し、収まる場合はLinearの0・EVの0 EVを優先する。
	// 残りは中央に近いものから選び、小さいパネルでも片側だけに目盛りが偏らないようにする。
	const candidates = ticks.filter(tick => tick.position > 0 && tick.position < 1).toSorted((first, second) =>
		Number(second.isReference) - Number(first.isReference)
		|| Math.abs(first.position - 0.5) - Math.abs(second.position - 0.5)
		|| first.position - second.position,
	);
	for (const candidate of candidates) {
		if (selected.every(tick => Math.abs(tick.position - candidate.position) * extent >= minimumSpacing)) {
			selected.push(candidate);
		}
	}
	return selected.toSorted((first, second) => first.position - second.position);
}
