import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

// 配置と見た目は形状の種類から独立させる。Scene・クリップ・レイヤーの情報は持たず、
// 将来パスなどが加わっても、形状の定義が配置先へ依存しないようにする。
const commonShapeParamDefs = {
	position: {
		dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false,
	},
	rotation: {
		dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
	fillEnabled: {
		dataType: { kind: 'bool' }, ui: { label: 'Fill', control: {} },
		defaultValue: { inputSource: 'literal', value: true }, canNode: false,
	},
	fillColor: {
		dataType: { kind: 'color' }, ui: { label: 'Fill color', control: {} },
		defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] }, canNode: false,
	},
	strokeEnabled: {
		dataType: { kind: 'bool' }, ui: { label: 'Stroke', control: {} },
		defaultValue: { inputSource: 'literal', value: false }, canNode: false,
	},
	strokeColor: {
		dataType: { kind: 'color' }, ui: { label: 'Stroke color', control: {} },
		defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] }, canNode: false,
	},
	strokeWidth: {
		dataType: { kind: 'scalar' }, ui: { label: 'Stroke width', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
		defaultValue: { inputSource: 'literal', value: 0.01 }, canNode: false,
	},
	strokeProgress: {
		dataType: { kind: 'scalar' }, ui: { label: 'Stroke progress', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 }, canNode: false,
	},
	strokeStart: {
		dataType: { kind: 'scalar' }, ui: { label: 'Stroke start', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
	strokeAlignment: {
		dataType: { kind: 'enum', options: ['inside', 'center', 'outside'] },
		ui: { label: 'Stroke alignment', control: { labels: { inside: 'Inside', center: 'Center', outside: 'Outside' } } },
		defaultValue: { inputSource: 'literal', value: 'center' }, canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;

// 寸法は輪郭を付ける前の全幅・全高。縦横とも描画先の高さを1とするため、
// 正方形や真円が横長のSceneで歪まず、プレビュー倍率によって大きさも変わらない。
const sizeParamDef = {
	dataType: { kind: 'vector' }, ui: { label: 'Size', control: { controlType: 'wh', min: 0, max: 2, step: 0.01 } },
	defaultValue: { inputSource: 'literal', value: [0.5, 0.5] }, canNode: false,
} as const satisfies ParameterDefinition;

export const shapeDefinitions = {
	ellipse: { label: 'Ellipse', paramDefs: { size: sizeParamDef, ...commonShapeParamDefs } },
	rectangle: { label: 'Rectangle', paramDefs: {
		size: sizeParamDef,
		cornerRadius: {
			dataType: { kind: 'scalar' }, ui: { label: 'Corner radius', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
		},
		...commonShapeParamDefs,
	} },
} as const satisfies Record<string, { label: string; paramDefs: Record<string, ParameterDefinition> }>;

export type ShapeType = keyof typeof shapeDefinitions;
export type Shape = { [T in ShapeType]: {
	type: T;
	paramValues: Record<keyof typeof shapeDefinitions[T]['paramDefs'], ValueParameterBinding>;
} }[ShapeType];

export function getShapeParameterDefinitions(type: ShapeType): Record<string, ParameterDefinition> {
	if (!Object.hasOwn(shapeDefinitions, type)) throw new Error(`Unknown shape type: ${type}`);
	return shapeDefinitions[type].paramDefs;
}

export function createShape(type: ShapeType): Shape {
	const defs = getShapeParameterDefinitions(type);
	// キーは種類別の定義から生成する。既定値の配列を別のシェイプと共有しない。
	return { type, paramValues: Object.fromEntries(Object.entries(defs).map(([key, def]) => [key, deepClone(def.defaultValue)])) } as Shape;
}

type EvaluatedShapeBase = {
	position: [number, number];
	rotation: number;
	fillColor: [number, number, number, number];
	strokeColor: [number, number, number, number];
	strokeWidth: number;
	strokeProgress: number;
	strokeStart: number;
	strokeAlignment: 'inside' | 'center' | 'outside';
};

// 評価済みの値にはBindingを含めない。描画処理は式・Scene・保存データを知らない。
export type EvaluatedShape = EvaluatedShapeBase & (
	| { type: 'ellipse'; size: [number, number] }
	| { type: 'rectangle'; size: [number, number]; cornerRadius: number }
);
