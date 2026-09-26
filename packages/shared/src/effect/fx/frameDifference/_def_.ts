import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'frameDifference',
	displayName: 'Frame difference',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: { dataType: { kind: 'enum', options: ['rgb', 'luminance'] }, ui: { label: 'Mode', control: { labels: { 'rgb': 'RGB', 'luminance': 'Luminance' } } }, defaultValue: { inputSource: 'literal', value: 'rgb' } },
		gain: { dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
