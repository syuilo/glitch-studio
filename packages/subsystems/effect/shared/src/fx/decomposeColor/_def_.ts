import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'decomposeColor',
	displayName: 'Decompose Color',
	description: {
		'ja-JP': '色を未乗算の赤・緑・青とアルファのスカラー値に分解します。アルファが0の画素のRGBは0になります。',
		'en-US': 'Splits a color into straight red, green, blue, and alpha scalar values. RGB is zero for fully transparent pixels.',
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
