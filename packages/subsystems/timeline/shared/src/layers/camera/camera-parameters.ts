import { TimelineParameterBindingEvaluator } from '../../parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '../../evaluation-scope.ts';
import { DEFAULT_CAMERA_DISTANCE, timelineCameraParamDefs } from './camera.ts';
import type { TimelineCamera, EvaluatedTimelineCamera } from './camera.ts';

export class TimelineCameraParameters {
	private evaluator = new TimelineParameterBindingEvaluator();
	evaluate(camera: TimelineCamera | undefined, time: number, isExport: boolean): EvaluatedTimelineCamera {
		const scope = createTimelineLayerEvaluationScope({ time, isExport, automationGraphs: camera?.automationGraphs ?? [] });
		const read = (key: keyof typeof timelineCameraParamDefs): unknown => {
			const fallback = timelineCameraParamDefs[key].defaultValue.value;
			const binding = camera?.paramValues[key];
			return binding == null ? fallback : this.evaluator.evaluate(binding, scope, fallback);
		};
		const position = read('position');
		const z = read('z');
		const fieldOfView = read('fieldOfView');
		return {
			position: [0, 1].map(index => Array.isArray(position) && Number.isFinite(position[index]) ? position[index] : 0) as [number, number],
			z: typeof z === 'number' && Number.isFinite(z) ? z : DEFAULT_CAMERA_DISTANCE,
			fieldOfView: typeof fieldOfView === 'number' && Number.isFinite(fieldOfView) ? Math.max(1, Math.min(175, fieldOfView)) : 45,
		};
	}
}
