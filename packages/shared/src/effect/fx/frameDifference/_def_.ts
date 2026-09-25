import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'frameDifference',
	displayName: 'Frame difference',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: { dataType: 'enum', ui: { label: 'Mode', control: 'enum' }, options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], defaultValue: { inputSource: 'literal', value: 'rgb' } },
		gain: { dataType: 'scalar', ui: { label: 'Gain', control: 'range', min: 0, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		threshold: { dataType: 'scalar', ui: { label: 'Threshold', control: 'range', min: 0, max: 1, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
