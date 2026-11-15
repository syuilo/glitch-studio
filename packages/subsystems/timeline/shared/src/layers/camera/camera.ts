import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { validateTimelineParameterTree } from '../../parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineParameterBinding } from '../../parameter-binding.ts';

// XY・ZともSceneの長辺全体を1とする。+Zはカメラ側。
// 長辺方向の画角45°でZ=0の2D配置を保つ距離は、Sceneの縦横比によらず共通となる。
export const DEFAULT_CAMERA_DISTANCE = 0.5 / Math.tan(Math.PI / 8);
// 視点との距離0による発散を避ける、共通単位の数値的な近接限界。
export const CAMERA_NEAR_DISTANCE = 0.000001;

export const timelineCameraParamDefs = {
	position: {
		dataType: { kind: 'vector' },
		ui: {
			label: 'Camera XY',
			control: {
				controlType: 'xy',
				min: -0.5,
				max: 0.5,
				step: 0.01,
			},
		},
		defaultValue: { inputSource: 'literal', value: [0, 0] },
		canNode: false,
	},
	z: {
		dataType: { kind: 'scalar' },
		ui: {
			label: 'Camera Z',
			control: {
				controlType: 'range',
				min: -10,
				max: 10,
				step: 0.01,
			},
		},
		defaultValue: { inputSource: 'literal', value: DEFAULT_CAMERA_DISTANCE },
		canNode: false,
	},
	roll: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Roll', control: { controlType: 'angle' } },
		defaultValue: { inputSource: 'literal', value: 0 },
		canNode: false,
	},
	fieldOfView: {
		dataType: { kind: 'scalar' },
		ui: {
			label: 'Long side field of view (degrees)',
			control: {
				controlType: 'range',
				min: 1,
				max: 175,
				step: 1,
			},
		},
		defaultValue: { inputSource: 'literal', value: 45 },
		canNode: false,
	},
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
export type EvaluatedTimelineCamera = { position: [number, number]; z: number; roll: number; fieldOfView: number };

// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function validateTimelineCamera(camera: TimelineCamera | null | undefined): void {
	if (!camera) return;
	for (const [key, binding] of Object.entries(camera.paramValues)) {
		if (!Object.hasOwn(timelineCameraParamDefs, key)) throw new Error(`Unknown camera parameter: ${key}`);
		if (binding) validateTimelineParameterTree(timelineCameraParamDefs[key as keyof typeof timelineCameraParamDefs], binding);
	}
}

