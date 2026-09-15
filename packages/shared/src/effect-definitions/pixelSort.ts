import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'pixelSort',
	displayName: 'Pixel sort',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		threshold: { type: 'range', label: 'Threshold', min: 0, max: 1, step: 0.001, default: () => ({ type: 'literal', value: 0.5 }) },
		shadow: { type: 'bool', label: 'Shadow', default: () => ({ type: 'literal', value: true }) },
		direction: { type: 'enum', label: 'Direction', options: [
			{ label: 'Horizontal', value: 'horizontal' },
			{ label: 'Vertical', value: 'vertical' },
		], default: () => ({ type: 'literal', value: 'horizontal' }) },
		order: { type: 'enum', label: 'Order', options: [
			{ label: 'A > B', value: 'descending' },
			{ label: 'B > A', value: 'ascending' },
		], default: () => ({ type: 'literal', value: 'descending' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
