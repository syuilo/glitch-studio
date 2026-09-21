import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'quadtreeFilter',
	displayName: 'Quadtree filter',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		threshold: { dataType: 'scalar', ui: { label: 'Thresold', control: 'range', min: 0, max: 0.15, step: 0.00001 }, defaultValue: { inputSource: 'literal', value: 0.005 } },
		minDivisions: { dataType: 'scalar', ui: { label: 'Min divisions', control: 'range', min: 1, max: 64, step: 1 }, defaultValue: { inputSource: 'literal', value: 4 } },
		maxIterations: { dataType: 'scalar', ui: { label: 'Max iterations', control: 'range', min: 1, max: 16, step: 1 }, defaultValue: { inputSource: 'literal', value: 10 } },
		borderWidth: { dataType: 'scalar', ui: { label: 'Border width', control: 'range', min: 0, max: 1, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 0 } },
		borderAbsolute: { dataType: 'bool', ui: { label: 'Border absolute', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
