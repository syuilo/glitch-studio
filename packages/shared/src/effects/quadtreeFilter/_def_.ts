import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'quadtreeFilter',
	displayName: 'Quadtree filter',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		threshold: { dataType: 'number', ui: { control: 'range', min: 0, max: 0.15, step: 0.00001 }, label: 'Thresold', default: () => ({ inputSource: 'literal', value: 0.005 }) },
		minDivisions: { dataType: 'number', ui: { control: 'range', min: 1, max: 64, step: 1 }, label: 'Min divisions', default: () => ({ inputSource: 'literal', value: 4 }) },
		maxIterations: { dataType: 'number', ui: { control: 'range', min: 1, max: 16, step: 1 }, label: 'Max iterations', default: () => ({ inputSource: 'literal', value: 10 }) },
		borderWidth: { dataType: 'number', ui: { control: 'range', min: 0, max: 1, step: 0.001 }, label: 'Border width', default: () => ({ inputSource: 'literal', value: 0 }) },
		borderAbsolute: { dataType: 'bool', ui: { control: 'bool' }, label: 'Border absolute', default: () => ({ inputSource: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
