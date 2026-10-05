import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorSelector',
	displayName: 'Selector (Color)',
	description: {
		'ja-JP': '画像・色の一覧から0始まりのインデックスで入力を選択します。小数では隣接する入力を線形補間し、範囲外は先頭または末尾に固定します。',
		'en-US': 'Selects from color inputs using a zero-based index. Fractional indices linearly interpolate adjacent inputs; out-of-range indices clamp to the first or last input.',
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
	// 配列の特定要素を主入力にせず、解像度は描画先に従う。
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
