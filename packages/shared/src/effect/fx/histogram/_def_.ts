import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'histogram',
	displayName: 'Histogram',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		resolution: {
			dataType: { kind: 'enum', options: ['1', '2', '4', '8', '16'] },
			ui: { label: 'Sampling resolution', control: { labels: { '1': '1/1', '2': '1/2', '4': '1/4', '8': '1/8', '16': '1/16' } } },
			defaultValue: { inputSource: 'literal', value: '1' },
		},
		mode: { dataType: { kind: 'enum', options: ['rgb', 'luminance'] }, ui: { label: 'Mode', control: { labels: { 'rgb': 'RGB', 'luminance': 'Luminance' } } }, defaultValue: { inputSource: 'literal', value: 'rgb' } },
		height: { dataType: { kind: 'scalar' }, ui: { label: 'Height', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
