// Adapted from Paper Design's Neuro Noise (Apache-2.0; see LICENSE and NOTICE).
// Modified: evolving time, node colors/background and Glitch Studio sizing.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'neuroNoise',
	displayName: 'Neuro Noise',
	tags: [],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: 'color', ui: { label: 'Background', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		colorFront: { dataType: 'color', ui: { label: 'Highlight Color', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		colorMid: { dataType: 'color', ui: { label: 'Main Color', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [71 / 255, 166 / 255, 1, 1] } },
		brightness: { dataType: 'scalar', ui: { label: 'Brightness', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		contrast: { dataType: 'scalar', ui: { label: 'Contrast', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		time: { dataType: 'scalar', ui: { label: 'Time', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		scale: { dataType: 'scalar', ui: { label: 'Scale', control: 'range', min: 0.01, max: 4, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
		offset: { dataType: 'vector', ui: { label: 'Offset', control: 'vector', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
