export type EasingFamily = 'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';
export type EasingDirection = 'in' | 'out' | 'inOut';

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

function easeIn(progress: number, family: EasingFamily): number {
	// Expo・Elasticの端点と三角関数の丸めを補正し、キーの値やInOutの中点を正確に保つ。
	if (progress === 0 || progress === 1) return progress;
	switch (family) {
		case 'sine': return 1 - Math.cos(progress * Math.PI / 2);
		case 'quad': return progress ** 2;
		case 'cubic': return progress ** 3;
		case 'quart': return progress ** 4;
		case 'quint': return progress ** 5;
		case 'expo': return 2 ** (10 * progress - 10);
		case 'circ': return 1 - Math.sqrt(1 - progress ** 2);
		case 'back': {
			// 標準的な係数で、一度逆方向へ溜めてから終点へ向かう3次曲線を作る。
			const overshoot = 1.70158;
			return (overshoot + 1) * progress ** 3 - overshoot * progress ** 2;
		}
		case 'elastic':
			// 周期0.3の振動を指数関数で増幅し、Inの終点が1となる位相に合わせる。
			// 方向を変えても基準曲線は共通とし、InOut固有の周期調整は行わない。
			return -(2 ** (10 * progress - 10)) * Math.sin((progress * 10 - 10.75) * (2 * Math.PI / 3));
		case 'bounce': return 1 - bounceOut(1 - progress);
	}
}

/** 0〜1の区間進行率を変換する。Back・Elasticの出力は0〜1の範囲を超える。 */
export function evaluateEasing(progress: number, family: EasingFamily, direction: EasingDirection): number {
	switch (direction) {
		case 'in': return easeIn(progress, family);
		case 'out': return 1 - easeIn(1 - progress, family);
		case 'inOut':
			// 前半にIn、後半にOutをそれぞれ時間・値とも半分に縮めて配置する。
			// 結果をクランプするとBack・Elasticのオーバーシュートが失われるため、そのまま返す。
			return progress < 0.5
				? easeIn(progress * 2, family) / 2
				: 1 - easeIn((1 - progress) * 2, family) / 2;
	}
}
