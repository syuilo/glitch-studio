export const MAXIMUM_TRANSFORM_COUNT = 16;
export const MAXIMUM_ORBIT_COUNT = 4096;
export const MAXIMUM_ITERATIONS = 2048;
export const MAXIMUM_BURN_IN = 2048;
export const MAXIMUM_PLOTTED_SAMPLES = 8388608;
export const FIXED_POINT_SCALE = 256;
export const MODEL_UNITS_PER_SPATIAL_UNIT = 4;

export type FlameTransform = {
	weight: number;
	position: readonly [number, number];
	rotation: number;
	scale: readonly [number, number];
	shear: number;
	colorPosition: number;
	variations: { linear: number; sinusoidal: number; spherical: number; swirl: number; horseshoe: number; polar: number; handkerchief: number; heart: number; };
};

export function packFlameTransforms(transforms: readonly FlameTransform[]) {
	if (transforms.length > MAXIMUM_TRANSFORM_COUNT) throw new Error(`Fractal Flame supports at most ${MAXIMUM_TRANSFORM_COUNT} transforms.`);
	for (const transform of transforms) {
		const values = [transform.weight, ...transform.position, transform.rotation, ...transform.scale, transform.shear, transform.colorPosition, ...Object.values(transform.variations)];
		if (!values.every(value => Number.isFinite(Math.fround(value)))) throw new Error('Fractal Flame requires finite transform parameters representable as f32.');
		if (transform.weight < 0) throw new Error('Fractal Flame transform weights must be nonnegative.');
	}
	// 無効な変換は確率分布へ入れない。全変換のWeight=0や空リストは空画像にする。
	const active = transforms.filter(transform => transform.weight > 0);
	const largestWeight = Math.max(0, ...active.map(transform => transform.weight));
	const scaledTotal = active.reduce((total, transform) => total + transform.weight / largestWeight, 0);
	const values = new Float32Array(MAXIMUM_TRANSFORM_COUNT * 16);
	let cumulativeWeight = 0;
	for (const [index, transform] of active.entries()) {
		cumulativeWeight += transform.weight / largestWeight / scaledTotal;
		const rotation = (transform.rotation % 1) * 2 * Math.PI;
		const cosine = Math.cos(rotation);
		const sine = Math.sin(rotation);
		// 先に拡縮・X方向のshearを適用し、その後に時計回りの回転と移動を適用する。
		// Translationだけを共通空間単位からモデル単位へ換算し、Scale・Shearは無次元のまま保つ。
		values.set([
			cosine * transform.scale[0], (cosine * transform.shear + sine) * transform.scale[1], transform.position[0] * MODEL_UNITS_PER_SPATIAL_UNIT,
			index === active.length - 1 ? 1 : cumulativeWeight,
			-sine * transform.scale[0], (cosine - sine * transform.shear) * transform.scale[1], transform.position[1] * MODEL_UNITS_PER_SPATIAL_UNIT,
			Math.min(1, Math.max(0, transform.colorPosition)),
			transform.variations.linear, transform.variations.sinusoidal, transform.variations.spherical, transform.variations.swirl,
			transform.variations.horseshoe, transform.variations.polar, transform.variations.handkerchief, transform.variations.heart,
		], index * 16);
	}
	if (!values.every(Number.isFinite)) throw new Error('Fractal Flame affine coefficients exceed GPU float32 range.');
	return { values, count: active.length };
}

export function planFlameSampling(orbitCount: number, iterations: number, burnIn: number, symmetry: number, mirror: boolean) {
	if (![orbitCount, iterations, burnIn, symmetry].every(Number.isFinite)) throw new Error('Fractal Flame requires finite sample counts and symmetry.');
	const normalizedOrbitCount = Math.min(MAXIMUM_ORBIT_COUNT, Math.max(1, Math.floor(orbitCount)));
	const normalizedIterations = Math.min(MAXIMUM_ITERATIONS, Math.max(1, Math.floor(iterations)));
	const normalizedBurnIn = Math.min(MAXIMUM_BURN_IN, Math.max(0, Math.floor(burnIn)));
	const symmetryOrder = Math.min(16, Math.max(1, Math.floor(symmetry)));
	const sampleCount = normalizedOrbitCount * normalizedIterations * symmetryOrder * (mirror ? 2 : 1);
	// 1点・1セルの整数加算は各チャンネル最大256。総点数を2^23以下に抑えれば、
	// 全点が同じセルへ集中しても最大2^31となり、u32の集計がoverflowしない。
	if (sampleCount > MAXIMUM_PLOTTED_SAMPLES) throw new Error('Fractal Flame exceeds 8388608 plotted samples. Reduce Orbit Count, Iterations or Symmetry.');
	return { orbitCount: normalizedOrbitCount, iterations: normalizedIterations, burnIn: normalizedBurnIn, symmetryOrder, sampleCount };
}
