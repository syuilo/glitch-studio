import { VHS_SIGNAL } from './signal.ts';

export const VHS_HEAD_SPACING = {
	radius: 64,
	tapCount: 129,
	levelCount: 65,
} as const;

/**
 * Wallaceのスペーシング損失 H(f)=exp(-2π |f| d/v) をFIRへ変換する。
 * 入力は g=d/λ_ref なので、H(f)=exp(-2π g |f|/f_ref) と書ける。
 * 各レベルの係数は毎フレーム作らず、隙間から補間して混合RFへ適用する。
 */
export function createVhsHeadSpacingFilters(): Float32Array {
	const { radius, tapCount, levelCount } = VHS_HEAD_SPACING;
	const values = new Float32Array(tapCount * levelCount);
	const sampleRate = VHS_SIGNAL.rfSamples / VHS_SIGNAL.linePeriod;
	values[radius] = 1;
	for (let level = 1; level < levelCount; level++) {
		const separation = level / (levelCount - 1);
		const decay = 2 * Math.PI * separation * sampleRate / VHS_SIGNAL.fmReferenceFrequency;
		for (let offset = -radius; offset <= radius; offset++) {
			// Nyquist区間のexp(-decay*|f/Fs|)を逆変換した実数・偶対称の係数。
			// expm1を使い、接触に近い小さな隙間でも中心係数の桁落ちを避ける。
			const coefficient = offset === 0 ? -2 * Math.expm1(-decay / 2) / decay
				: 2 * decay * (1 - (Math.abs(offset) % 2 === 0 ? 1 : -1) * Math.exp(-decay / 2)) / (decay * decay + (2 * Math.PI * offset) ** 2);
			const window = 0.5 + 0.5 * Math.cos(Math.PI * offset / radius);
			// 有限長によるリップルをHann窓で抑える。DCで再正規化するとRF帯域を
			// 不当に増幅するため行わない。約0.63〜4.4MHzで誤差を検証する。
			values[level * tapCount + offset + radius] = coefficient * window;
		}
	}
	return values;
}
