import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rgbTo',
	displayName: 'RGB To',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: {
			dataType: { kind: 'enum', options: ['intensity', 'luminance'] },
			ui: { label: 'Mode', control: { labels: { 'intensity': 'Intensity', 'luminance': 'Luminance' } } },
			defaultValue: { inputSource: 'literal', value: 'intensity' },
		},
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'scalar' } },
	},
});
