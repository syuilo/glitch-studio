import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'quadtreeFilter',
	displayName: 'Quadtree filter',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		threshold: { type: 'range', min: 0, max: 0.15, step: 0.00001, label: 'Thresold', default: () => ({ type: 'literal', value: 0.005 }) },
		minDivisions: { type: 'range', min: 1, max: 64, step: 1, label: 'Min divisions', default: () => ({ type: 'literal', value: 4 }) },
		maxIterations: { type: 'range', min: 1, max: 16, step: 1, label: 'Max iterations', default: () => ({ type: 'literal', value: 10 }) },
		borderWidth: { type: 'range', min: 0, max: 1, step: 0.001, label: 'Border width', default: () => ({ type: 'literal', value: 0 }) },
		borderAbsolute: { type: 'bool', label: 'Border absolute', default: () => ({ type: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
