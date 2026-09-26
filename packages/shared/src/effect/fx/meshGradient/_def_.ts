import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'meshGradient',
	displayName: 'Mesh Gradient',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		colors: {
			dataType: 'array',
			ui: { label: 'Colors' },
			item: {
				dataType: 'color', ui: { label: 'Color', control: 'color' }, canNode: true,
				defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
			},
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ inputSource: 'literal', value: [224 / 255, 234 / 255, 1, 1] },
					{ inputSource: 'literal', value: [36 / 255, 29 / 255, 154 / 255, 1] },
					{ inputSource: 'literal', value: [247 / 255, 80 / 255, 146 / 255, 1] },
					{ inputSource: 'literal', value: [159 / 255, 80 / 255, 211 / 255, 1] },
				],
			},
		},
		time: { dataType: 'scalar', ui: { label: 'Time', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		distortion: { dataType: 'scalar', ui: { label: 'Distortion', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		swirl: { dataType: 'scalar', ui: { label: 'Swirl', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		grainMixer: { dataType: 'scalar', ui: { label: 'Grain Mixer', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		grainOverlay: { dataType: 'scalar', ui: { label: 'Grain Overlay', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		scale: { dataType: 'scalar', ui: { label: 'Scale', control: 'range', min: 0.01, max: 4, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
		offset: { dataType: 'vector', ui: { label: 'Offset', control: 'vector', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
