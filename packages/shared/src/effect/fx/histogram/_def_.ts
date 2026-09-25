import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'histogram',
	displayName: 'Histogram',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		resolution: { dataType: 'enum', ui: { label: 'Sampling resolution', control: 'enum' }, options: [
			{ label: '1/1', value: 1 },
			{ label: '1/2', value: 2 },
			{ label: '1/4', value: 4 },
			{ label: '1/8', value: 8 },
			{ label: '1/16', value: 16 },
		], defaultValue: { inputSource: 'literal', value: 1 } },
		mode: { dataType: 'enum', ui: { label: 'Mode', control: 'enum' }, options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], defaultValue: { inputSource: 'literal', value: 'rgb' } },
		height: { dataType: 'scalar', ui: { label: 'Height', control: 'range', min: 0, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
