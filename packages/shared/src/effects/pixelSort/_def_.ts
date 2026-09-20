import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelSort',
	displayName: 'Pixel sort',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		threshold: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.001 }, label: 'Threshold', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		shadow: { dataType: 'bool', ui: { control: 'bool' }, label: 'Shadow', default: () => ({ inputSource: 'literal', value: true }) },
		direction: { dataType: 'enum', ui: { control: 'enum' }, label: 'Direction', options: [
			{ label: 'Horizontal', value: 'horizontal' },
			{ label: 'Vertical', value: 'vertical' },
		], default: () => ({ inputSource: 'literal', value: 'horizontal' }) },
		order: { dataType: 'enum', ui: { control: 'enum' }, label: 'Order', options: [
			{ label: 'A > B', value: 'descending' },
			{ label: 'B > A', value: 'ascending' },
		], default: () => ({ inputSource: 'literal', value: 'descending' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
