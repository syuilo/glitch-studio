import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelSort',
	displayName: 'Pixel sort',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		threshold: { type: 'range', label: 'Threshold', min: 0, max: 1, step: 0.001, default: () => ({ inputSource: 'literal', value: 0.5 }) },
		shadow: { type: 'bool', label: 'Shadow', default: () => ({ inputSource: 'literal', value: true }) },
		direction: { type: 'enum', label: 'Direction', options: [
			{ label: 'Horizontal', value: 'horizontal' },
			{ label: 'Vertical', value: 'vertical' },
		], default: () => ({ inputSource: 'literal', value: 'horizontal' }) },
		order: { type: 'enum', label: 'Order', options: [
			{ label: 'A > B', value: 'descending' },
			{ label: 'B > A', value: 'ascending' },
		], default: () => ({ inputSource: 'literal', value: 'descending' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
