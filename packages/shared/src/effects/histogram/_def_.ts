import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'histogram',
	displayName: 'Histogram',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		resolution: { type: 'enum', label: 'Sampling resolution', options: [
			{ label: '1/1', value: 1 },
			{ label: '1/2', value: 2 },
			{ label: '1/4', value: 4 },
			{ label: '1/8', value: 8 },
			{ label: '1/16', value: 16 },
		], default: () => ({ inputSource: 'literal', value: 1 }) },
		mode: { type: 'enum', label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ inputSource: 'literal', value: 'rgb' }) },
		height: { type: 'range', label: 'Height', min: 0, max: 10, step: 0.01, default: () => ({ inputSource: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
