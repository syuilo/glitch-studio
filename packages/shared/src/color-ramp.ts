import { linearSrgbToOklab, linearSrgbToOklch, linearSrgbToSrgb, OKLCH_POWERLESS_CHROMA, oklabToLinearSrgb, oklchToLinearSrgb, srgbChannelToLinear } from './color-space.ts';
import type { LinearSrgbColor } from './color-space.ts';

export type ColorRampColor = LinearSrgbColor;
export type ColorRampStop = { id: string; position: number; color: ColorRampColor };
/** 配列の順序はWGSLのColorRampSettings.interpolationへ渡す番号と対応する。 */
export const COLOR_RAMP_INTERPOLATIONS = ['constant', 'linear', 'smoothstep', 'smootherstep', 'easeIn', 'easeOut'] as const;
export type ColorRamp = {
	stops: ColorRampStop[];
	interpolation: typeof COLOR_RAMP_INTERPOLATIONS[number];
	colorSpace: 'srgb' | 'linearSrgb' | 'oklab' | 'oklch';
	/** OKLCHの色相経路。省略時はCSSと同じshorterで、他の色空間には影響しない。 */
	hueInterpolation?: 'shorter' | 'longer' | 'increasing' | 'decreasing';
};

export function createDefaultColorRamp(): ColorRamp {
	return { interpolation: 'linear', colorSpace: 'linearSrgb', stops: [
		{ id: 'start', position: 0, color: [0, 0, 0, 1] },
		{ id: 'end', position: 1, color: [1, 1, 1, 1] },
	] };
}

/** 保存値と式の戻り値に同じ契約を適用する。範囲の補正で入力ミスを隠さない。 */
export function validateColorRamp(value: unknown): asserts value is ColorRamp {
	if (value == null || typeof value !== 'object') throw new Error('Expected a Color Ramp object');
	const ramp = value as Record<string, unknown>;
	if (typeof ramp.interpolation !== 'string' || !COLOR_RAMP_INTERPOLATIONS.some(interpolation => interpolation === ramp.interpolation)) throw new Error('Invalid Color Ramp interpolation');
	if (typeof ramp.colorSpace !== 'string' || !['srgb', 'linearSrgb', 'oklab', 'oklch'].includes(ramp.colorSpace)) throw new Error('Invalid Color Ramp color space');
	if (ramp.hueInterpolation != null && (typeof ramp.hueInterpolation !== 'string' || !['shorter', 'longer', 'increasing', 'decreasing'].includes(ramp.hueInterpolation))) throw new Error('Invalid Color Ramp hue interpolation');
	if (!Array.isArray(ramp.stops) || ramp.stops.length === 0) throw new Error('Color Ramp requires at least one stop');
	const ids = new Set<string>();
	for (const candidate of ramp.stops as unknown[]) {
		if (candidate == null || typeof candidate !== 'object') throw new Error('Expected a Color Ramp stop object');
		const stop = candidate as Record<string, unknown>;
		if (typeof stop.id !== 'string' || stop.id.length === 0 || ids.has(stop.id)) throw new Error('Color Ramp stop IDs must be nonempty and unique');
		ids.add(stop.id);
		if (typeof stop.position !== 'number' || !Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1) throw new Error('Color Ramp stop positions must be finite numbers between 0 and 1');
		if (!Array.isArray(stop.color) || stop.color.length !== 4 || !stop.color.every((component: unknown) => typeof component === 'number' && Number.isFinite(component))) throw new Error('Color Ramp stop colors must contain four finite RGBA components');
		if (stop.color[3] < 0 || stop.color[3] > 1) throw new Error('Color Ramp alpha must be between 0 and 1');
	}
}

function toWorkingColor(color: ColorRampColor, colorSpace: ColorRamp['colorSpace']): ColorRampColor {
	if (colorSpace === 'srgb') return linearSrgbToSrgb(color);
	if (colorSpace === 'linearSrgb') return [...color];
	if (colorSpace === 'oklab') return linearSrgbToOklab(color);
	const [lightness, chroma, hue, alpha] = linearSrgbToOklch(color);
	// グレーの変換誤差に由来する色相を補間に混ぜないよう、微小なchromaを0へ揃える。
	// Color Ramp内部とGPU転送では色相の1周を1とする。
	if (chroma <= OKLCH_POWERLESS_CHROMA) return [lightness, 0, 0, alpha];
	return [lightness, chroma, hue / 360, alpha];
}

export type PreparedColorRamp = Pick<ColorRamp, 'interpolation' | 'colorSpace'> & {
	stops: { position: number; color: ColorRampColor; linearColor: ColorRampColor; segmentHues: [number, number] | null }[];
};

/** 区間ごとに色相を補い、CSS Color 4の経路に従って連続した角度へ展開する。 */
function prepareSegmentHues(left: ColorRampColor, right: ColorRampColor, method: NonNullable<ColorRamp['hueInterpolation']>): [number, number] {
	// 無彩色は相手の色相を借りる。有彩色のalpha=0は無彩色とは異なり、
	// 色相を保持する。alphaの0と微小な正値で経路が切り替わらないため。
	let start = left[1] === 0 ? right[2] : left[2];
	let end = right[1] === 0 ? start : right[2];
	const difference = end - start;
	switch (method) {
		case 'shorter':
			if (difference > 0.5) start += 1;
			else if (difference < -0.5) end += 1;
			break;
		case 'longer':
			if (difference > 0 && difference < 0.5) start += 1;
			else if (difference > -0.5 && difference <= 0) end += 1;
			break;
		case 'increasing':
			if (end < start) end += 1;
			break;
		case 'decreasing':
			if (start < end) start += 1;
			break;
	}
	return [start, end];
}

/** UIとGPU転送で共有する。保存順を保ったstable sortで、同位置では後のstopを優先する。 */
export function prepareColorRamp(ramp: ColorRamp): PreparedColorRamp {
	validateColorRamp(ramp);
	const stops = ramp.stops.map(stop => ({ position: Math.fround(stop.position), color: toWorkingColor(stop.color, ramp.colorSpace), linearColor: stop.color })).sort((a, b) => a.position - b.position);
	return { interpolation: ramp.interpolation, colorSpace: ramp.colorSpace, stops: stops.map((stop, index) => {
		const color = stop.color;
		const alpha = color[3];
		// alpha=0を分岐して、極端なRGBの変換結果によるInfinity * 0を避ける。
		const working: ColorRampColor = alpha === 0 ? [0, 0, 0, 0] : [color[0] * alpha, color[1] * alpha, color[2] * alpha, alpha];
		// OKLCHではL・Cだけを乗算する。色相の補間区間はCPUで一度だけ準備し、
		// GPUでも同じ値を使うことで無彩色・経路・alphaの規則を二重実装しない。
		const segmentHues = ramp.colorSpace === 'oklch' ? prepareSegmentHues(color, stops[index + 1]?.color ?? color, ramp.hueInterpolation ?? 'shorter') : null;
		if (ramp.colorSpace === 'oklch') working[2] = color[2];
		if (!working.every(component => Number.isFinite(Math.fround(component)))) throw new Error('Color Ramp color exceeds GPU float32 range');
		const linearColor = stop.linearColor;
		return { position: stop.position, color: working, linearColor: [linearColor[0] * alpha, linearColor[1] * alpha, linearColor[2] * alpha, alpha] as ColorRampColor, segmentHues };
	}) };
}

/** 補間空間によらず、出力は乗算済みlinear sRGBへ戻す。GPU側も同じ順序で変換する。 */
function toOutputColor(color: ColorRampColor, colorSpace: ColorRamp['colorSpace']): ColorRampColor {
	const alpha = color[3];
	if (alpha <= 0) return [0, 0, 0, 0];
	let [r, g, b] = [color[0] / alpha, color[1] / alpha, colorSpace === 'oklch' ? color[2] : color[2] / alpha];
	if (colorSpace === 'oklch') {
		// 色相はalphaを乗算していないため、補間後もそのまま度数法へ戻す。
		[r, g, b] = oklchToLinearSrgb([r, g, b * 360, alpha]);
	} else if (colorSpace === 'oklab') {
		[r, g, b] = oklabToLinearSrgb([r, g, b, alpha]);
	}
	if (colorSpace === 'srgb') [r, g, b] = [r, g, b].map(srgbChannelToLinear);
	return [r * alpha, g * alpha, b * alpha, alpha];
}

/** 戻り値は乗算済みlinear sRGB。同位置の最後のstopを選び、幅0の区間を補間しない。 */
export function evaluatePreparedColorRamp(ramp: PreparedColorRamp, position: number): ColorRampColor {
	const stops = ramp.stops;
	if (Number.isNaN(position) || position < stops[0].position) return [...stops[0].linearColor];
	let lower = 0;
	let upper = stops.length;
	while (lower < upper) {
		const middle = Math.floor((lower + upper) / 2);
		if (stops[middle].position <= position) lower = middle + 1; else upper = middle;
	}
	const left = stops[lower - 1];
	if (lower === stops.length || position === left.position || ramp.interpolation === 'constant') return [...left.linearColor];
	const right = stops[lower];
	let amount = (position - left.position) / (right.position - left.position);
	if (ramp.interpolation === 'smoothstep') {
		amount = amount * amount * (3 - 2 * amount);
	} else if (ramp.interpolation === 'smootherstep') {
		// 両端で1階・2階微分が0になる5次式。stop付近をより長く保ち、中央で速く変化させる。
		amount = amount * amount * amount * (amount * (amount * 6 - 15) + 10);
	} else if (ramp.interpolation === 'easeIn') {
		amount = amount * amount;
	} else if (ramp.interpolation === 'easeOut') {
		// 1 - (1 - t)^2と等価だが、小さなtで1同士の減算による桁落ちを避ける。
		amount = amount * (2 - amount);
	}
	const color = left.color.map((component, index) => component + (right.color[index] - component) * amount) as ColorRampColor;
	if (left.segmentHues != null) color[2] = left.segmentHues[0] + (left.segmentHues[1] - left.segmentHues[0]) * amount;
	return toOutputColor(color, ramp.colorSpace);
}
