import { createIntegrationSchedule } from './integration-schedule.ts';

import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

export function getDoublePendulumFractalRenderWorkloadHint(inputs: Parameters<NativeEffectImplementation<typeof definition.paramDefs, 'ramp' | 'coloringMethod' | 'angularVelocityRange'>['init']>[0]['inputs'], outputPorts: readonly string[]) {
	// 描画と同じスケジュールを使い、最後の端数もRK4の1回として数える。
	// uniformへの転送で0へ丸められる端数は、GPUでも積分しない。
	const schedule = createIntegrationSchedule(inputs.simulationTime.value, inputs.timeStep.value);
	const integrationSteps = schedule.fullSteps + (Math.fround(schedule.remainder) > 0 ? 1 : 0);
	const rendersColor = outputPorts.includes('output');
	const usesRamp = rendersColor && inputs.coloringMethod!.value !== 'sphericalRgb';
	return {
		// 時刻0でも座標の変換・配色・出力は必要なので、固定処理の1を加える。
		// 複数ポートは同じ積分結果を共有するため、出力数で反復数を増やさない。
		workPerPixel: (1 + integrationSteps) * (inputs.antialiasing.value ? 4 : 1),
		// 早期終了がなく全画素が同じ回数だけ積分するため、視点移動・ズームでは学習を保つ。
		// 積分回数とAAは比率で比較し、物理条件・配色方式の変更は再計測する。
		// 色の値だけを変えた場合や、データ出力だけを使う場合の配色変更では学習を維持する。
		key: JSON.stringify([inputs.initialAngularVelocity1.value, inputs.initialAngularVelocity2.value,
			inputs.lengthRatio.value, inputs.massRatio.value, inputs.gravity.value, rendersColor ? inputs.coloringMethod!.value : null,
			usesRamp ? [inputs.angularVelocityRange!.value, inputs.ramp!.value.stops.length, inputs.ramp!.value.interpolation, inputs.ramp!.value.colorSpace] : null,
			outputPorts]),
	};
}
