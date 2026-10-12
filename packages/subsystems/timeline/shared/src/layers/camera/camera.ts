import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { inspectTimelineParameters } from '../../parameter-validation.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineParameterBinding } from '../../parameter-binding.ts';

// Zの1はSceneの半分の高さ。+Zはカメラ側で、初期視点ではZ=0の画面が従来と一致する。
export const DEFAULT_CAMERA_DISTANCE = 1 / Math.tan(Math.PI / 8);
export const CAMERA_NEAR_DISTANCE = 0.001;
export const timelineCameraParamDefs = {
	position: { dataType: { kind: 'vector' }, ui: { label: 'Camera XY', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false },
	z: { dataType: { kind: 'scalar' }, ui: { label: 'Camera Z', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: DEFAULT_CAMERA_DISTANCE }, canNode: false },
	fieldOfView: { dataType: { kind: 'scalar' }, ui: { label: 'Vertical field of view (degrees)', control: { controlType: 'range', min: 1, max: 175, step: 1 } }, defaultValue: { inputSource: 'literal', value: 45 }, canNode: false },
} as const satisfies Record<string, ParameterDefinition>;

export type TimelineCameraParameterValues = Record<keyof typeof timelineCameraParamDefs, TimelineParameterBinding>;

export function createTimelineCameraParameterValues(): TimelineCameraParameterValues {
	return Object.fromEntries(Object.entries(timelineCameraParamDefs).map(([key, def]) => [key, deepClone(def.defaultValue)])) as TimelineCameraParameterValues;
}

/** 評価器へ渡す設定。カメラ選択・クリップの有効期間はScene側で解決する。 */
export type TimelineCamera = {
	paramValues: Partial<TimelineCameraParameterValues>;
	automationGraphs: AutomationGraph[];
};
export type EvaluatedTimelineCamera = { position: [number, number]; z: number; fieldOfView: number };

export function validateTimelineCamera(camera: TimelineCamera | undefined): void {
	if (!camera) return;
	const diagnostics = inspectTimelineParameters(timelineCameraParamDefs, camera.paramValues, false, false, 'camera parameter');
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

