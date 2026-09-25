import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'tearings',
	displayName: 'Tearings',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 100 }, defaultValue: { inputSource: 'literal', value: 3 } },
		strength: { dataType: 'scalar', ui: { label: 'Strength', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.02 } },
		size: { dataType: 'scalar', ui: { label: 'Size', control: 'range', min: 0, max: 100, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 20 } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
		channelShift: { dataType: 'scalar', ui: { label: 'Ch shift', control: 'range', min: 0, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		seed: { dataType: 'scalar', ui: { label: 'Seed', control: 'seed' }, defaultValue: { inputSource: 'envVariable', variable: 'TIME' } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
