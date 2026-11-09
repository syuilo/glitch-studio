import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'applyLut',
	displayName: 'Apply LUT',
	description: {
		'ja-JP': 'LUTを使って入力画像の色調を変換します。',
		'en-US': 'Transforms the colors of the input image using a LUT.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	staticSettingDefs: {
		lut: { dataType: { kind: 'assetReference', assetType: 'lut' }, ui: { label: 'LUT' }, defaultValue: null },
	},
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		inputColorSpace: {
			dataType: { kind: 'enum', options: ['linearSrgb', 'srgb'] },
			ui: { label: 'LUT Input Color Space', control: { labels: { linearSrgb: 'Linear sRGB', srgb: 'sRGB' } } },
			defaultValue: { inputSource: 'literal', value: 'linearSrgb' },
		},
		outputColorSpace: {
			dataType: { kind: 'enum', options: ['linearSrgb', 'srgb'] },
			ui: { label: 'LUT Output Color Space', control: { labels: { linearSrgb: 'Linear sRGB', srgb: 'sRGB' } } },
			defaultValue: { inputSource: 'literal', value: 'linearSrgb' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
