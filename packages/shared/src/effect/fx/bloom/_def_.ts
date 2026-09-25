import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'bloom',
	displayName: 'Bloom',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		strength: { dataType: 'scalar', ui: { label: 'Strength', control: 'range', min: 0, max: 5, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		threshold: { dataType: 'scalar', ui: { label: 'Threshold', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.7 } },
		softKnee: { dataType: 'scalar', ui: { label: 'Soft knee', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		radius: { dataType: 'vector', ui: { label: 'Radius', control: 'vector', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0.7, 0.7] } },
		quality: { dataType: 'scalar', ui: { label: 'Quality', control: 'range', min: 0.1, max: 1, step: 0.05 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
