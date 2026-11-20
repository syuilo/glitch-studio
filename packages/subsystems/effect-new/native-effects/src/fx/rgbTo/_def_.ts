import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'RGB to',
	summary: {
		'ja-JP': 'RGBの色を、明るさや輝度を表すスカラー値に変換します。',
		'en-US': 'Converts RGB colors into scalar intensity or luminance values.',
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
		mode: {
			dataType: { kind: 'enum', options: ['intensity', 'luminance'] },
			ui: { label: 'Mode', control: { labels: { 'intensity': 'Intensity', 'luminance': 'Luminance' } } },
			defaultValue: { inputSource: 'literal', value: 'intensity' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
