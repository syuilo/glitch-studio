export type Resolution = { width: number; height: number };

// 寸法は正の整数、倍率は正の有限数であることを呼び出し側で保証する。
// 各軸へ倍率を掛けて四捨五入し、最低1pxを保つ。
export function scaleResolution(resolution: Resolution, scale: number): Resolution {
	return {
		width: Math.max(1, Math.round(resolution.width * scale)),
		height: Math.max(1, Math.round(resolution.height * scale)),
	};
}
