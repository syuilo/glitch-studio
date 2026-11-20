import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

// 各画素が所属する葉だけを探索する方式でも、密度入力の参照回数に上限を設ける。
const maximumCellSubdivisionLevels = 8;

export const cellSubdivisionParameterDefinitions = {
	subdivisionMode: {
		dataType: { kind: 'enum', options: ['uniform', 'adaptive'] },
		ui: {
			label: 'Subdivision Mode',
			control: { labels: { uniform: 'Uniform', adaptive: 'Adaptive' } },
		},
		defaultValue: { inputSource: 'literal', value: 'uniform' },
	},
	// 各候補セルの中心で評価する。0〜1を最大深度までの目標深度へ四捨五入し、
	// その深度に達するまで四分割する。0では基本格子、1では最大深度まで分割する。
	densityMap: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Density Map', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
		canNode: true,
		defaultValue: { inputSource: 'literal', value: 0.5 },
	},
	maxSubdivisionLevels: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Max Subdivision Levels', control: { controlType: 'range', min: 0, max: maximumCellSubdivisionLevels, step: 1 } },
		defaultValue: { inputSource: 'literal', value: 4 },
	},
} as const satisfies Record<string, ParameterDefinition>;

/** Uniformでは探索を行わず、式で与えた深度も有限の整数へ揃える。 */
export function getCellSubdivisionLevels(subdivisionMode: 'uniform' | 'adaptive', levels: number): number {
	if (subdivisionMode === 'uniform' || !Number.isFinite(levels)) return 0;
	return Math.min(maximumCellSubdivisionLevels, Math.max(0, Math.round(levels)));
}
