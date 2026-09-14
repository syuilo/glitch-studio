import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'histogram',
	displayName: 'Histogram',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		resolution: { type: 'enum', label: 'Sampling resolution', options: [
			{ label: '1/1', value: 1 },
			{ label: '1/2', value: 2 },
			{ label: '1/4', value: 4 },
			{ label: '1/8', value: 8 },
			{ label: '1/16', value: 16 },
		], default: () => ({ type: 'literal', value: 1 }) },
		mode: { type: 'enum', label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ type: 'literal', value: 'rgb' }) },
		height: { type: 'range', label: 'Height', min: 0, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
