import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelSort',
	displayName: 'Pixel sort',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		threshold: { dataType: 'scalar', ui: { label: 'Threshold', control: 'range', min: 0, max: 1, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		shadow: { dataType: 'bool', ui: { label: 'Shadow', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
		direction: { dataType: 'enum', ui: { label: 'Direction', control: 'enum' }, options: [
			{ label: 'Horizontal', value: 'horizontal' },
			{ label: 'Vertical', value: 'vertical' },
		], defaultValue: { inputSource: 'literal', value: 'horizontal' } },
		order: { dataType: 'enum', ui: { label: 'Order', control: 'enum' }, options: [
			{ label: 'A > B', value: 'descending' },
			{ label: 'B > A', value: 'ascending' },
		], defaultValue: { inputSource: 'literal', value: 'descending' } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
