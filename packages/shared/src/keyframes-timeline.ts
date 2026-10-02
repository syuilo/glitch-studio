import type { DataType } from './data-type.ts';
import type { EasingFamily, EasingDirection } from './easing.ts';

export type KeyframesDataType = Extract<DataType, { kind: 'scalar' | 'vector' | 'color' | 'string' | 'bool' | 'enum' }>;
export type InterpolatedKeyframesDataType = Extract<KeyframesDataType, { kind: 'scalar' | 'vector' | 'color' }>;
export type KeyframeInterpolation = { type: 'hold' } | { type: 'linear' } | { type: `ease:${EasingFamily}`; direction: EasingDirection };

export type KeyframeValue<T extends KeyframesDataType = KeyframesDataType> =
	T extends { kind: 'scalar' } ? number
		: T extends { kind: 'vector' } ? [number, number]
			: T extends { kind: 'color' } ? [number, number, number, number]
				: T extends { kind: 'bool' } ? boolean
					: T extends { kind: 'enum'; options: readonly string[] } ? T['options'][number]
						: string;

export type KeyframesTimelineKeyframe<T extends KeyframesDataType = KeyframesDataType> = T extends KeyframesDataType ? {
	id: string;
	x: number;
	value: KeyframeValue<T>;
	// 次のキーまでの補間。離散値はHoldのみ、最後のキーでは使用しない。
	interpolation: T extends InterpolatedKeyframesDataType ? KeyframeInterpolation : { type: 'hold' };
} : never;

// 型ごとに分配し、タイムラインの型とキーの値・補間方式の対応を維持する。
// Binding側でOmitを使うとunionの対応が失われるため、登録情報を持たない形を基本とする。
export type KeyframesTimelineData<T extends KeyframesDataType = KeyframesDataType> = T extends KeyframesDataType ? {
	dataType: T;
	keyframes: KeyframesTimelineKeyframe<T>[];
	isNormalized: boolean; // falseの場合はX軸単位がms
} : never;

export type KeyframesTimeline = KeyframesTimelineData & { id: string; name: string };

export function isKeyframesDataType(dataType: DataType): dataType is KeyframesDataType {
	return supportsKeyframeInterpolation(dataType) || dataType.kind === 'string' || dataType.kind === 'bool' || dataType.kind === 'enum';
}

export function supportsKeyframeInterpolation(dataType: DataType): dataType is InterpolatedKeyframesDataType {
	return dataType.kind === 'scalar' || dataType.kind === 'vector' || dataType.kind === 'color';
}

// enumの候補内かどうかは、利用時の最新のパラメータ定義で別途検証する。
// 選択肢の削除後も既存キーを移動・修正できるよう、ここでは保存値の形だけを検証する。
export function isKeyframeValue(dataType: KeyframesDataType, value: unknown): value is KeyframeValue {
	switch (dataType.kind) {
		case 'scalar': return typeof value === 'number' && Number.isFinite(value);
		case 'vector':
		case 'color': return Array.isArray(value) && value.length === (dataType.kind === 'vector' ? 2 : 4) && value.every(component => typeof component === 'number' && Number.isFinite(component));
		case 'bool': return typeof value === 'boolean';
		case 'string':
		case 'enum': return typeof value === 'string';
	}
}
