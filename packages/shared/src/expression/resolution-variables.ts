import type { Resolution } from '../resolution.ts';

// 呼び出し側で倍率・丸めを適用した解像度を受け取り、両変数が必ず同じ寸法を表すようにする。
// どのノードやレイヤーの解像度を使うかは、この関数では決めない。
export function createResolutionExpressionVariables(resolution: Resolution): { RESOLUTION: [number, number]; ASPECT_RATIO: number } {
	return {
		RESOLUTION: [resolution.width, resolution.height],
		ASPECT_RATIO: resolution.width / resolution.height,
	};
}
