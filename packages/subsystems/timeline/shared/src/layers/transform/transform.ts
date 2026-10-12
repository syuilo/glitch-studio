import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { inspectTimelineParameters } from '../../parameter-validation.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineParameterBinding } from '../../parameter-binding.ts';

export const timelineTransformParamDefs = {
	position: { dataType: { kind: 'vector' }, ui: { label: 'Position XY', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false },
	z: { dataType: { kind: 'scalar' }, ui: { label: 'Position Z', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 }, canNode: false },
} as const satisfies Record<string, ParameterDefinition>;

export type TimelineTransformParameterValues = Record<keyof typeof timelineTransformParamDefs, TimelineParameterBinding>;
export type EvaluatedTimelineTransform = { position: [number, number]; z: number };

export function createTimelineTransformParameterValues(): TimelineTransformParameterValues {
	return Object.fromEntries(Object.entries(timelineTransformParamDefs).map(([key, def]) => [key, deepClone(def.defaultValue)])) as TimelineTransformParameterValues;
}

export function validateTimelineTransform(values: TimelineTransformParameterValues): void {
	const diagnostics = inspectTimelineParameters(timelineTransformParamDefs, values, false, false, 'transform parameter');
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}
