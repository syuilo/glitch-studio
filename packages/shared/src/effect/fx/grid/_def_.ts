import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'grid',
	displayName: 'Grid',
	tags: ['pattern'],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: { kind: 'color' }, ui: { label: 'Background', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		size: {
			dataType: { kind: 'vector' },
			ui: { label: 'Size', control: { controlType: 'vector', min: 0.001, max: 1, logarithmic: true } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] },
		},
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		majorWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Major width', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.036 } },
		majorColor: { dataType: { kind: 'color' }, ui: { label: 'Major color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.75] } },
		minorDivisions: { dataType: { kind: 'scalar' }, ui: { label: 'Minor divisions', control: { controlType: 'range', min: 0, max: 16, step: 1 } }, defaultValue: { inputSource: 'literal', value: 4 } },
		minorWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Minor width', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.036 } },
		minorColor: { dataType: { kind: 'color' }, ui: { label: 'Minor color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
