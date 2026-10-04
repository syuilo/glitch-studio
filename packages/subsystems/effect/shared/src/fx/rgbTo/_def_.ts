import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rgbTo',
	displayName: 'RGB To',
	description: {
		'ja-JP': 'RGBの色を、明るさや輝度を表すスカラー値に変換します。',
		'en-US': 'Converts RGB colors into scalar intensity or luminance values.',
	},
	kind: 'modify',
	tags: ['color', 'utility', 'convert'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: {
			dataType: { kind: 'enum', options: ['intensity', 'luminance'] },
			ui: { label: 'Mode', control: { labels: { 'intensity': 'Intensity', 'luminance': 'Luminance' } } },
			defaultValue: { inputSource: 'literal', value: 'intensity' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
