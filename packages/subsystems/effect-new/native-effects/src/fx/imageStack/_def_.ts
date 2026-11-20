import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Image Stack',
	summary: {
		'ja-JP': '複数の画像や色を、均等な領域に分けて横または縦に並べます。',
		'en-US': 'Arranges images or colors horizontally or vertically in equally sized regions.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transform', 'utility'],
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Inputs', control: { element: {} } },
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ id: 'first', binding: { inputSource: 'literal', value: [0, 0, 0, 0] } },
					{ id: 'second', binding: { inputSource: 'literal', value: [0, 0, 0, 0] } },
				],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		},
		direction: {
			dataType: { kind: 'enum', options: ['horizontal', 'vertical'] },
			ui: { label: 'Direction', control: { labels: { horizontal: 'Horizontal', vertical: 'Vertical' } } },
			defaultValue: { inputSource: 'literal', value: 'horizontal' },
		},
		gap: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gap', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		padding: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Padding', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: 'longSide' },
		},
	},
	// 特定の配列要素を主入力にせず、出力寸法は既存の解像度設定に従う。
	// 自動解像度でも入力を連結した寸法にはせず、全入力の最大画素数を採用する。
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
