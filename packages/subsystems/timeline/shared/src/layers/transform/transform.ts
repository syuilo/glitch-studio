import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { validateTimelineParameterTree } from '../../parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineParameterBinding } from '../../parameter-binding.ts';

export const timelineTransformParamDefs = {
	position: { dataType: { kind: 'vector' }, ui: { label: 'Position XY', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false },
	z: { dataType: { kind: 'scalar' }, ui: { label: 'Position Z', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 }, canNode: false },
	scale: { dataType: { kind: 'vector' }, ui: { label: 'Scale', control: { controlType: 'dimension', min: -2, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [1, 1] }, canNode: false },
	rotation: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 }, canNode: false },
} as const satisfies Record<string, ParameterDefinition>;

export type TimelineTransformParameterValues = Record<keyof typeof timelineTransformParamDefs, TimelineParameterBinding>;
export type EvaluatedTimelineTransform = { position: [number, number]; z: number; scale: [number, number]; rotation: number };

export function createTimelineTransformParameterValues(): TimelineTransformParameterValues {
	return Object.fromEntries(Object.entries(timelineTransformParamDefs).map(([key, def]) => [key, deepClone(def.defaultValue)])) as TimelineTransformParameterValues;
}

export function validateTimelineTransform(values: TimelineTransformParameterValues): void {
	for (const [key, binding] of Object.entries(values)) {
		if (!Object.hasOwn(timelineTransformParamDefs, key)) throw new Error(`Unknown transform parameter: ${key}`);
		validateTimelineParameterTree(timelineTransformParamDefs[key as keyof typeof timelineTransformParamDefs], binding);
	}
}
