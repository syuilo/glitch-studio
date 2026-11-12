import type { EffectImplementation } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

/** シェーダーへ渡す上限とヒントの反復数を揃える。 */
export function getMagneticPendulumMaximumSteps(maximumSteps: number): number {
	return Math.min(2048, Math.max(1, Math.floor(maximumSteps)));
}

export const getMagneticPendulumRenderWorkloadHint: NonNullable<EffectImplementation<typeof definition>['getRenderWorkloadHint']> = ({ params, usedOutputPorts }) => {
	// 係数の画像が変わると収束までの仕事も変わる。画像内容の世代を追跡できない
	// 入力では、過去の軽い描画を根拠に大きい最初のパスを送らない。
	if (params.damping.kind !== 'uniform' || params.restoringStrength.kind !== 'uniform') return null;
	return {
		workPerPixel: getMagneticPendulumMaximumSteps(params.maximumSteps) * Math.max(1, params.magnets.length) * (params.antialiasing ? 4 : 1),
		// ステップ数とAAは比率で比較する。それ以外の物理条件・表示領域が変わると、
		// 早期収束する領域も変わるため再計測する。配色の値だけなら積分負荷は変わらない。
		key: JSON.stringify([params.magnets.map(magnet => [magnet.position, magnet.height, magnet.strength, magnet.color.kind]),
			params.damping.value, params.restoringStrength.value, params.initialVelocity, params.view,
			params.timeStep, params.captureRadius, params.captureSpeed, params.unconvergedColor.kind,
			usedOutputPorts == null ? null : [...usedOutputPorts].sort()]),
	};
};
