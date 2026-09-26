import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelSort',
	displayName: 'Pixel sort',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		shadow: { dataType: { kind: 'bool' }, ui: { label: 'Shadow', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		direction: {
			dataType: { kind: 'enum', options: ['horizontal', 'vertical'] },
			ui: { label: 'Direction', control: { labels: { 'horizontal': 'Horizontal', 'vertical': 'Vertical' } } },
			defaultValue: { inputSource: 'literal', value: 'horizontal' },
		},
		order: {
			dataType: { kind: 'enum', options: ['descending', 'ascending'] },
			ui: { label: 'Order', control: { labels: { 'descending': 'A > B', 'ascending': 'B > A' } } },
			defaultValue: { inputSource: 'literal', value: 'descending' },
		},
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
