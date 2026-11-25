export const EASING_FAMILIES = ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'] as const;
export type EasingFamily = typeof EASING_FAMILIES[number];
export const EASING_DIRECTIONS = ['in', 'out', 'inOut'] as const;
export type EasingDirection = typeof EASING_DIRECTIONS[number];

export const DEFAULT_BACK_OVERSHOOT_COEFFICIENT = 1.70158;
export const DEFAULT_ELASTIC_PERIOD = 0.3;

export type EasingSettings = { direction: EasingDirection } & (
	| { family: 'back'; overshootCoefficient?: number | null }
	| { family: 'elastic'; period?: number | null }
	| { family: Exclude<EasingFamily, 'back' | 'elastic'> }
);

export function smoothstep(progress: number): number {
	return progress * progress * (3 - 2 * progress);
}

export function smootherstep(progress: number): number {
	return progress ** 3 * (progress * (progress * 6 - 15) + 10);
}

// Bounceは着地後の跳ね返り（Out）を区分的な放物線で表すと分かりやすいため、
// この関数だけOutで記述し、系統の基準曲線を返す際にInへ反転する。
function bounceOut(progress: number): number {
	const coefficient = 7.5625;
	const duration = 2.75;
	if (progress < 1 / duration) return coefficient * progress ** 2;
	if (progress < 2 / duration) return coefficient * (progress - 1.5 / duration) ** 2 + 0.75;
	if (progress < 2.5 / duration) return coefficient * (progress - 2.25 / duration) ** 2 + 0.9375;
	return coefficient * (progress - 2.625 / duration) ** 2 + 0.984375;
}

function easeIn(progress: number, easing: EasingSettings): number {
	// Expo・Elasticの端点と三角関数の丸めを補正し、キーの値やInOutの中点を正確に保つ。
	if (progress === 0 || progress === 1) return progress;
	switch (easing.family) {
		case 'sine': return 1 - Math.cos(progress * Math.PI / 2);
		case 'quad': return progress ** 2;
		case 'cubic': return progress ** 3;
		case 'quart': return progress ** 4;
		case 'quint': return progress ** 5;
		case 'expo': return 2 ** (10 * progress - 10);
		case 'circ': return 1 - Math.sqrt(1 - progress ** 2);
		case 'back': {
			// 正の係数で一度逆方向へ溜める。0のときはCubicと同じ曲線になる。
			const coefficient = easing.overshootCoefficient ?? DEFAULT_BACK_OVERSHOOT_COEFFICIENT;
			return (coefficient + 1) * progress ** 3 - coefficient * progress ** 2;
		}
		case 'elastic': {
			const period = easing.period ?? DEFAULT_ELASTIC_PERIOD;
			// 終点を位相0に固定する。除算前に一周期へ折り返し、極めて短い周期でも位相を有限に保つ。
			const phase = ((progress - 1) % period) / period;
			return 2 ** (10 * progress - 10) * Math.cos(phase * (2 * Math.PI));
		}
		case 'bounce': return 1 - bounceOut(1 - progress);
	}
}

/** 0〜1の区間進行率を変換する。Back・Elasticの出力は0〜1の範囲を超える。 */
export function evaluateEasing(progress: number, easing: EasingSettings): number {
	switch (easing.direction) {
		case 'in': return easeIn(progress, easing);
		case 'out': return 1 - easeIn(1 - progress, easing);
		case 'inOut':
			// 前半にIn、後半にOutをそれぞれ時間・値とも半分に縮めて配置する。
			// 結果をクランプするとBack・Elasticのオーバーシュートが失われるため、そのまま返す。
			return progress < 0.5
				? easeIn(progress * 2, easing) / 2
				: 1 - easeIn((1 - progress) * 2, easing) / 2;
	}
}
