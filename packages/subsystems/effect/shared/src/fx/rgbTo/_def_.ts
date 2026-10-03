import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rgbTo',
	displayName: 'RGB To',
	kind: 'modify',
	tags: [],
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
