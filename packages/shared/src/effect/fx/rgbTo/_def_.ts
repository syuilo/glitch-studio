import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rgbTo',
	displayName: 'RGB To',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: {
			dataType: 'enum', ui: { label: 'Mode', control: 'enum' },
			options: [{
				label: 'Intensity',
				value: 0,
			}, {
				label: 'Luminance',
				value: 1,
			}],
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	outputDefs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
