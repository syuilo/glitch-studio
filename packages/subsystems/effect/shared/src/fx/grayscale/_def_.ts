import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'grayscale',
	displayName: 'Grayscale',
	description: {
		'ja-JP': '入力画像をグレースケールに変換します。ValueはRGBの最大値、IntensityはRGBの平均値、LuminanceはRGBの重み付き和を使用します。',
		'en-US': 'Converts the input image to grayscale using value (the maximum RGB channel), intensity (the RGB average), or luminance (a weighted RGB sum).',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		mode: { dataType: { kind: 'enum', options: ['value', 'intensity', 'luminance'] }, ui: { label: 'Mode', control: { labels: { value: 'Value (Max)', intensity: 'Intensity (Average)', luminance: 'Luminance' } } }, defaultValue: { inputSource: 'literal', value: 'luminance' } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
