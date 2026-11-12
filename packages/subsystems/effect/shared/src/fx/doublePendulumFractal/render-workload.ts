import { createIntegrationSchedule } from './integration-schedule.ts';
import type { EffectImplementation } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

export const getDoublePendulumFractalRenderWorkloadHint: NonNullable<EffectImplementation<typeof definition>['getRenderWorkloadHint']> = ({ params, usedOutputPorts }) => {
	// 描画と同じスケジュールを使い、最後の端数もRK4の1回として数える。
	// uniformへの転送で0へ丸められる端数は、GPUでも積分しない。
	const schedule = createIntegrationSchedule(params.simulationTime, params.timeStep);
	const integrationSteps = schedule.fullSteps + (Math.fround(schedule.remainder) > 0 ? 1 : 0);
	const rendersColor = usedOutputPorts == null || usedOutputPorts.has('output');
	const usesRamp = rendersColor && params.coloringMethod !== 'sphericalRgb';
	return {
		// 時刻0でも座標の変換・配色・出力は必要なので、固定処理の1を加える。
		// 複数ポートは同じ積分結果を共有するため、出力数で反復数を増やさない。
		workPerPixel: (1 + integrationSteps) * (params.antialiasing ? 4 : 1),
		// 積分回数とAAは比率で比較し、物理条件・表示領域・配色方式の変更は再計測する。
		// 色の値だけを変えた場合や、データ出力だけを使う場合の配色変更では学習を維持する。
		key: JSON.stringify([params.view, params.initialAngularVelocity1, params.initialAngularVelocity2,
			params.lengthRatio, params.massRatio, params.gravity, rendersColor ? params.coloringMethod : null,
			usesRamp ? [params.angularVelocityRange, params.ramp.stops.length, params.ramp.interpolation, params.ramp.colorSpace] : null,
			usedOutputPorts == null ? null : [...usedOutputPorts].sort()]),
	};
};
