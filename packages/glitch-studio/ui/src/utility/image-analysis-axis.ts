import { DEFAULT_IMAGE_VALUE_RANGE, isDrawableImageValueRange } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';

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

export function createImageValueAxisTicks(valueScale: ImageValueScale, range: ImageValueRange = DEFAULT_IMAGE_VALUE_RANGE): ImageAnalysisAxisTick[] {
	if (!isDrawableImageValueRange(range)) return [];
	const { minimum, maximum } = range;
	const span = Math.abs(maximum - minimum);
	// Customでも読みやすい数値間隔を選び、端点は指定値のまま必ず残す。
	// 等分しただけの目盛りと違い、0をまたぐ非対称範囲でも0の基準線を表示できる。
	const roughStep = span / 4;
	const magnitude = 10 ** Math.floor(Math.log10(roughStep));
	const step = [1, 2, 2.5, 5, 10].map(value => value * magnitude)
		.reduce((selected, candidate) => Math.abs(candidate - roughStep) < Math.abs(selected - roughStep) ? candidate : selected);
	const values = [minimum, maximum];
	for (let index = Math.ceil(Math.min(minimum, maximum) / step); index <= Math.floor(Math.max(minimum, maximum) / step); index++) {
		const value = Number((index * step).toPrecision(12));
		if (values.every(existing => Math.abs(existing - value) / span > 1e-9)) values.push(value);
	}

	// 値はすでに選択した軸の単位。sRGB値を再encodeしたり、EV値を再log変換したりしない。
	// 正規化は@gs/shared/gpu/image-value-scale.wgslの集計位置と一致させる。
	return values.map(value => ({
		value,
		position: value === minimum ? 0 : value === maximum ? 1 : (value - minimum) / (maximum - minimum),
		label: value < 0 ? `−${Number(Math.abs(value).toPrecision(12))}` : valueScale === 'ev' && value > 0 ? `+${Number(value.toPrecision(12))}` : String(Number(value.toPrecision(12))),
		isReference: valueScale !== 'srgb' && value === 0,
	})).toSorted((first, second) => first.position - second.position);
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
