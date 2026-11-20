import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

/** シェーダーへ渡す上限とヒントの反復数を揃える。 */
export function getMagneticPendulumMaximumSteps(maximumSteps: number): number {
	return Math.min(2048, Math.max(1, Math.floor(maximumSteps)));
}

export function getMagneticPendulumRenderWorkloadHint(inputs: Parameters<NativeEffectImplementation<typeof definition.paramDefs, 'unconvergedColor' | 'settlingShading'>['init']>[0]['inputs'], outputPorts: readonly string[]) {
	// 係数の画像が変わると収束までの仕事も変わる。画像内容の世代を追跡できない
	// 入力では、過去の軽い描画を根拠に大きい最初のパスを送らない。
	if (inputs.damping.kind !== 'uniform' || inputs.restoringStrength.kind !== 'uniform') return null;
	return {
		workPerPixel: getMagneticPendulumMaximumSteps(inputs.maximumSteps.value) * Math.max(1, inputs.magnets.elements.length) * (inputs.antialiasing.value ? 4 : 1),
		// ステップ数とAAは比率で比較する。それ以外の物理条件・表示領域が変わると、
		// 早期収束する領域も変わるため再計測する。配色の値だけなら積分負荷は変わらない。
		key: JSON.stringify([inputs.magnets.elements.map(magnet => [magnet.fields.position.value, magnet.fields.height.value, magnet.fields.strength.value, magnet.fields.color.kind]),
			inputs.damping.value, inputs.restoringStrength.value, inputs.initialVelocity.value, [inputs.view.fields.center.value, inputs.view.fields.zoom.value],
			inputs.timeStep.value, inputs.captureRadius.value, inputs.captureSpeed.value, inputs.unconvergedColor?.kind,
			outputPorts]),
	};
}
