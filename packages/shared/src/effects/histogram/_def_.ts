import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'histogram',
	displayName: 'Histogram',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		resolution: { dataType: 'enum', ui: { control: 'enum' }, label: 'Sampling resolution', options: [
			{ label: '1/1', value: 1 },
			{ label: '1/2', value: 2 },
			{ label: '1/4', value: 4 },
			{ label: '1/8', value: 8 },
			{ label: '1/16', value: 16 },
		], default: () => ({ inputSource: 'literal', value: 1 }) },
		mode: { dataType: 'enum', ui: { control: 'enum' }, label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ inputSource: 'literal', value: 'rgb' }) },
		height: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 10, step: 0.01 }, label: 'Height', default: () => ({ inputSource: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
