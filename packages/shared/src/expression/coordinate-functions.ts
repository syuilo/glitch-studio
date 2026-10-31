import type { ExpressionFunction } from './expression-environment.ts';

/** 等方的な座標を、各軸が-1〜1の画面座標へ変換する。範囲外の座標もそのまま返す。 */
function isotropicToScreen(position: readonly [number, number], reference: 'shortSide' | 'longSide', aspectRatio: number): [number, number] {
	// aspectRatioは幅/高さ。短辺基準では長い軸の成分を縮め、長辺基準では短い軸の成分を広げる。
	// 画面上の距離へ戻したとき、X/Yに同じ倍率が掛かるため円や回転が歪まない。
	// 逆数を先に計算せず直接除算し、極端な比率で不要な中間値のオーバーフローも避ける。
	if (reference === 'shortSide') {
		return aspectRatio >= 1 ? [position[0] / aspectRatio, position[1]] : [position[0], position[1] * aspectRatio];
	}
	return aspectRatio >= 1 ? [position[0], position[1] * aspectRatio] : [position[0] / aspectRatio, position[1]];
}

// スコープへの依存は省略引数の補完だけに閉じ込め、座標の計算自体は純粋関数にする。
// 現在の評価スコープの値を毎回受け取り、別ノードや別の式評価の既定値を保持しない。
export function createCoordinateExpressionFunctions(defaultAspectRatio: unknown): Readonly<Record<'ISOTROPIC_TO_SCREEN', ExpressionFunction>> {
	return {
		ISOTROPIC_TO_SCREEN: (...args) => {
			const [position, referenceArgument, aspectRatioArgument] = args;
			if (args.length < 1 || args.length > 3 || !Array.isArray(position) || position.length !== 2
				|| typeof position[0] !== 'number' || !Number.isFinite(position[0])
				|| typeof position[1] !== 'number' || !Number.isFinite(position[1])) {
				throw new Error('ISOTROPIC_TO_SCREEN requires a finite [x, y] position and at most three arguments');
			}
			const reference = referenceArgument ?? 'shortSide';
			if (reference !== 'shortSide' && reference !== 'longSide') {
				throw new Error('ISOTROPIC_TO_SCREEN reference must be "shortSide" or "longSide"');
			}
			const aspectRatio = aspectRatioArgument ?? defaultAspectRatio;
			if (aspectRatio == null) {
				throw new Error('ISOTROPIC_TO_SCREEN requires an explicit aspect ratio when ASPECT_RATIO is unavailable');
			}
			if (typeof aspectRatio !== 'number' || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
				throw new Error('ISOTROPIC_TO_SCREEN aspect ratio must be positive and finite');
			}
			return isotropicToScreen([position[0], position[1]], reference, aspectRatio);
		},
	};
}
