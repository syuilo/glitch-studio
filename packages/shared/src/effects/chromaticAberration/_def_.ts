import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'chromaticAberration',
	displayName: 'Chromatic Aberration',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Amount', default: () => ({ inputSource: 'literal', value: 0.1 }) },
		rStrength: { dataType: 'scalar', ui: { control: 'range', min: -10, max: 10, step: 0.01 }, label: 'R strength', default: () => ({ inputSource: 'literal', value: 1 }) },
		gStrength: { dataType: 'scalar', ui: { control: 'range', min: -10, max: 10, step: 0.01 }, label: 'G strength', default: () => ({ inputSource: 'literal', value: 1.5 }) },
		bStrength: { dataType: 'scalar', ui: { control: 'range', min: -10, max: 10, step: 0.01 }, label: 'B strength', default: () => ({ inputSource: 'literal', value: 2 }) },
		samples: { dataType: 'scalar', ui: { control: 'number', min: 1, max: 100 }, label: 'Samples', default: () => ({ inputSource: 'literal', value: 32 }) },
		start: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Start', default: () => ({ inputSource: 'literal', value: 0 }) },
		vector: { dataType: 'vector', ui: { control: 'vector', step: 0.01, min: -5, max: 5 }, label: 'Vector', default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		normalize: { dataType: 'bool', ui: { control: 'bool' }, label: 'Normalize', default: () => ({ inputSource: 'literal', value: false }) },
		wrap: { dataType: 'wrapMode', ui: { control: 'wrapMode' }, label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
