export type ColorRampColor = [number, number, number, number];
export type ColorRampStop = { id: string; position: number; color: ColorRampColor };
export type ColorRamp = {
	stops: ColorRampStop[];
	interpolation: 'constant' | 'linear' | 'smoothstep';
	colorSpace: 'srgb' | 'linearSrgb' | 'oklab';
};

export function createDefaultColorRamp(): ColorRamp {
	return { interpolation: 'linear', colorSpace: 'srgb', stops: [
		{ id: 'start', position: 0, color: [0, 0, 0, 1] },
		{ id: 'end', position: 1, color: [1, 1, 1, 1] },
	] };
}

/** 保存値と式の戻り値に同じ契約を適用する。範囲の補正で入力ミスを隠さない。 */
export function validateColorRamp(value: unknown): asserts value is ColorRamp {
	if (value == null || typeof value !== 'object') throw new Error('Expected a Color Ramp object');
	const ramp = value as Record<string, unknown>;
	if (typeof ramp.interpolation !== 'string' || !['constant', 'linear', 'smoothstep'].includes(ramp.interpolation)) throw new Error('Invalid Color Ramp interpolation');
	if (typeof ramp.colorSpace !== 'string' || !['srgb', 'linearSrgb', 'oklab'].includes(ramp.colorSpace)) throw new Error('Invalid Color Ramp color space');
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

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const decodeSrgb = (value: number) => Math.abs(value) <= 0.04045 ? value / 12.92 : Math.sign(value) * ((Math.abs(value) + 0.055) / 1.055) ** 2.4;
const encodeSrgb = (value: number) => Math.abs(value) <= 0.0031308 ? value * 12.92 : Math.sign(value) * (1.055 * Math.abs(value) ** (1 / 2.4) - 0.055);

function toWorkingColor(color: ColorRampColor, colorSpace: ColorRamp['colorSpace']): ColorRampColor {
	if (colorSpace === 'srgb') return [...color];
	const [r, g, b] = color.slice(0, 3).map(decodeSrgb);
	if (colorSpace === 'linearSrgb') return [r, g, b, color[3]];
	// Oklabはlinear sRGBからLMSへ変換し、各成分の立方根を取ってからLabへ変換する。
	// 符号付きの立方根にして、式が返したsRGB範囲外の有限値もNaNにしない。
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, color[3]];
}

export type PreparedColorRamp = Pick<ColorRamp, 'interpolation' | 'colorSpace'> & {
	stops: { position: number; color: ColorRampColor; srgbColor: ColorRampColor }[];
};

/** UIとGPU転送で共有する。保存順を保ったstable sortで、同位置では後のstopを優先する。 */
export function prepareColorRamp(ramp: ColorRamp): PreparedColorRamp {
	validateColorRamp(ramp);
	return { interpolation: ramp.interpolation, colorSpace: ramp.colorSpace, stops: ramp.stops.map(stop => {
		const color = toWorkingColor(stop.color, ramp.colorSpace);
		const alpha = color[3];
		// alpha=0を分岐して、極端なRGBの変換結果によるInfinity * 0を避ける。
		const working: ColorRampColor = alpha === 0 ? [0, 0, 0, 0] : [color[0] * alpha, color[1] * alpha, color[2] * alpha, alpha];
		if (!working.every(component => Number.isFinite(Math.fround(component)))) throw new Error('Color Ramp color exceeds GPU float32 range');
		return { position: Math.fround(stop.position), color: working, srgbColor: [clamp(stop.color[0]) * alpha, clamp(stop.color[1]) * alpha, clamp(stop.color[2]) * alpha, alpha] as ColorRampColor };
	}).sort((a, b) => a.position - b.position) };
}

/** 補間用の乗算済み色を、出力用の乗算済みsRGBへ戻す。GPU側も同じ順序で変換する。 */
function toOutputColor(color: ColorRampColor, colorSpace: ColorRamp['colorSpace']): ColorRampColor {
	const alpha = color[3];
	if (alpha <= 0) return [0, 0, 0, 0];
	let [r, g, b] = color.slice(0, 3).map(component => component / alpha);
	if (colorSpace === 'oklab') {
		const l = (r + 0.3963377774 * g + 0.2158037573 * b) ** 3;
		const m = (r - 0.1055613458 * g - 0.0638541728 * b) ** 3;
		const s = (r - 0.0894841775 * g - 1.291485548 * b) ** 3;
		[r, g, b] = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
	}
	if (colorSpace !== 'srgb') [r, g, b] = [r, g, b].map(encodeSrgb);
	return [clamp(r) * alpha, clamp(g) * alpha, clamp(b) * alpha, alpha];
}

/** 戻り値は乗算済みsRGB。同位置の最後のstopを選び、幅0の区間を補間しない。 */
export function evaluatePreparedColorRamp(ramp: PreparedColorRamp, position: number): ColorRampColor {
	const stops = ramp.stops;
	if (Number.isNaN(position) || position < stops[0].position) return [...stops[0].srgbColor];
	let lower = 0;
	let upper = stops.length;
	while (lower < upper) {
		const middle = Math.floor((lower + upper) / 2);
		if (stops[middle].position <= position) lower = middle + 1; else upper = middle;
	}
	const left = stops[lower - 1];
	if (lower === stops.length || position === left.position || ramp.interpolation === 'constant') return [...left.srgbColor];
	const right = stops[lower];
	let amount = (position - left.position) / (right.position - left.position);
	if (ramp.interpolation === 'smoothstep') amount = amount * amount * (3 - 2 * amount);
	return toOutputColor(left.color.map((component, index) => component + (right.color[index] - component) * amount) as ColorRampColor, ramp.colorSpace);
}
