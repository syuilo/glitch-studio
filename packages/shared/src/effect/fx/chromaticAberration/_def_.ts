import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'chromaticAberration',
	displayName: 'Chromatic Aberration',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'cover' } },
		rStrength: { dataType: 'scalar', ui: { label: 'R strength', control: 'range', min: -10, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		gStrength: { dataType: 'scalar', ui: { label: 'G strength', control: 'range', min: -10, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1.5 } },
		bStrength: { dataType: 'scalar', ui: { label: 'B strength', control: 'range', min: -10, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 2 } },
		samples: { dataType: 'scalar', ui: { label: 'Samples', control: 'number', min: 1, max: 100 }, defaultValue: { inputSource: 'literal', value: 32 } },
		start: { dataType: 'scalar', ui: { label: 'Start', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		vector: { dataType: 'vector', ui: { label: 'Vector', control: 'vector', step: 0.01, min: -5, max: 5 }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		normalize: { dataType: 'bool', ui: { label: 'Normalize', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
