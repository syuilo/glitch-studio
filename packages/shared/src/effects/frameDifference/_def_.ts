import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'frameDifference',
	displayName: 'Frame difference',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		mode: { dataType: 'enum', ui: { control: 'enum' }, label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ inputSource: 'literal', value: 'rgb' }) },
		gain: { dataType: 'number', ui: { control: 'range', min: 0, max: 10, step: 0.01 }, label: 'Gain', default: () => ({ inputSource: 'literal', value: 1 }) },
		threshold: { dataType: 'number', ui: { control: 'range', min: 0, max: 1, step: 0.001 }, label: 'Threshold', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
