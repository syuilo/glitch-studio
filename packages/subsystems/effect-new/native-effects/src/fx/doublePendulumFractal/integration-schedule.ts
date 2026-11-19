// 画素ごとの積分を無制限に続けないための上限。上限に合わせて刻みを粗くしたり、
// 時刻を切り捨てたりすると別の模様になるので、到達不能な要求は描画前に通知する。
export const MAXIMUM_INTEGRATION_STEPS = 4096;

export function createIntegrationSchedule(simulationTime: number, timeStep: number) {
	if (!Number.isFinite(simulationTime) || !Number.isFinite(timeStep) || timeStep <= 0 || !Number.isFinite(Math.fround(timeStep)) || Math.fround(timeStep) <= 0) {
		throw new Error('Double Pendulum Fractal requires a finite Simulation Time and a positive finite Time Step representable as f32.');
	}
	const duration = Math.max(0, simulationTime);
	const stepCount = duration / timeStep;
	const nearestStepCount = Math.round(stepCount);
	// 0.3/0.1のような除算誤差だけを固定刻みの境界へ戻す。FPSや前回描画の
	// 端数は使わず、同じ指定時刻には常に同じ整数ステップと最終端数を割り当てる。
	const onStepBoundary = nearestStepCount > 0 && Math.abs(stepCount - nearestStepCount) <= Number.EPSILON * 8 * Math.max(1, stepCount);
	const fullSteps = onStepBoundary ? nearestStepCount : Math.floor(stepCount);
	const remainder = onStepBoundary ? 0 : duration - fullSteps * timeStep;
	if (!Number.isFinite(stepCount) || fullSteps + (remainder > 0 ? 1 : 0) > MAXIMUM_INTEGRATION_STEPS) {
		throw new Error(`Double Pendulum Fractal requires more than ${MAXIMUM_INTEGRATION_STEPS} integration steps. Reduce Simulation Time or increase Time Step (maximum duration at this step size: ${MAXIMUM_INTEGRATION_STEPS * timeStep} s).`);
	}
	return { fullSteps, remainder };
}
