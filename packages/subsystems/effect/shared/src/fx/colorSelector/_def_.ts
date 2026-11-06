import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorSelector',
	displayName: 'Selector (Color)',
	description: {
		'ja-JP': '複数の画像や色を切り替えたり、なめらかに混ぜ合わせたりします。',
		'en-US': 'Switches or smoothly blends between multiple images or colors.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'composite', 'utility'],
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Inputs', control: { element: {} } },
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ id: 'first', binding: { inputSource: 'literal', value: [0, 0, 0, 1] } },
					{ id: 'second', binding: { inputSource: 'literal', value: [0, 0, 0, 1] } },
				],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		},
		// 選択は描画全体で共通にし、候補数によらず最大2入力だけをGPUへ渡す。
		index: { dataType: { kind: 'scalar' }, ui: { label: 'Index', control: { controlType: 'number', min: 0, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	// 配列の特定要素を主入力にせず、自動解像度は全入力の静的な計画寸法の最大画素数から求める。
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
