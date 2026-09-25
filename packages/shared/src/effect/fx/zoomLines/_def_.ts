import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'zoomLines',
	displayName: 'Zoom lines',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		position: { dataType: 'vector', ui: { label: 'Position', control: 'vector', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		frequency: { dataType: 'scalar', ui: { label: 'Frequency', control: 'range', min: 0, max: 15, step: 0.1 }, defaultValue: { inputSource: 'literal', value: 5 } },
		density: { dataType: 'scalar', ui: { label: 'Density', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		outlineThickness: { dataType: 'scalar', ui: { label: 'Outline thickness', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.25 } },
		maskSize: { dataType: 'scalar', ui: { label: 'Mask size', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
