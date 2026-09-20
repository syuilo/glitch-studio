import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'frameDifference',
	displayName: 'Frame difference',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		mode: { type: 'enum', label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ inputSource: 'literal', value: 'rgb' }) },
		gain: { type: 'range', label: 'Gain', min: 0, max: 10, step: 0.01, default: () => ({ inputSource: 'literal', value: 1 }) },
		threshold: { type: 'range', label: 'Threshold', min: 0, max: 1, step: 0.001, default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
