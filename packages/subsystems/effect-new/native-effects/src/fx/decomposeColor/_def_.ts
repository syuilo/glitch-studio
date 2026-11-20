import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Decompose Color',
	summary: {
		'ja-JP': '色を赤・緑・青とアルファのスカラー値に分解します。',
		'en-US': 'Splits a color into red, green, blue, and alpha scalar values.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'utility', 'convert'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		red: { dataType: { kind: 'scalar' } },
		green: { dataType: { kind: 'scalar' } },
		blue: { dataType: { kind: 'scalar' } },
		alpha: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'red',
});
