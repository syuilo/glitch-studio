import { TimelineParameterBindingEvaluator } from '../../parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '../../evaluation-scope.ts';
import { timelineTransformParamDefs } from './transform.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineTransformParameterValues, EvaluatedTimelineTransform } from './transform.ts';

export class TimelineTransformParameters {
	private evaluator = new TimelineParameterBindingEvaluator();
	evaluate(values: TimelineTransformParameterValues, automationGraphs: AutomationGraph[], time: number, isExport: boolean): EvaluatedTimelineTransform {
		const scope = createTimelineLayerEvaluationScope({ time, isExport, automationGraphs });
		const read = (key: keyof typeof timelineTransformParamDefs): unknown => this.evaluator.evaluate(values[key], scope, timelineTransformParamDefs[key].defaultValue.value);
		const position = read('position');
		const z = read('z');
		return {
			position: [0, 1].map(index => Array.isArray(position) && Number.isFinite(position[index]) ? position[index] : 0) as [number, number],
			z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
		};
	}
}
