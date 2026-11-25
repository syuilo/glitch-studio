import type { TimelineLayerPublicParameterContext } from '../../public-parameters.ts';
import { TimelineParameterBindingEvaluator } from '../../parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '../../evaluation-scope.ts';
import { timelineTransformParamDefs } from './transform.ts';
import type { CurveAnimation } from '@gs/shared/curve-animation/curve-animation.ts';
import type { TimelineTransformParameterValues, EvaluatedTimelineTransform } from './transform.ts';

export class TimelineTransformParameters {
	private evaluator = new TimelineParameterBindingEvaluator();
	evaluate(values: TimelineTransformParameterValues, curveAnimations: CurveAnimation[], time: number, isExport: boolean, publicParameters?: TimelineLayerPublicParameterContext | null): EvaluatedTimelineTransform {
		const scope = createTimelineLayerEvaluationScope({ time, isExport, curveAnimations, publicParameters });
		const read = (key: keyof typeof timelineTransformParamDefs): unknown => this.evaluator.evaluate(values[key], scope, timelineTransformParamDefs[key].defaultValue, timelineTransformParamDefs[key]);
		const position = read('position');
		const z = read('z');
		const scale = read('scale');
		const rotation = read('rotation');
		return {
			position: [0, 1].map(index => Array.isArray(position) && Number.isFinite(position[index]) ? position[index] : 0) as [number, number],
			z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
			scale: [0, 1].map(index => Array.isArray(scale) && Number.isFinite(scale[index]) ? scale[index] : 1) as [number, number],
			rotation: typeof rotation === 'number' && Number.isFinite(rotation) ? rotation : 0,
		};
	}
}
