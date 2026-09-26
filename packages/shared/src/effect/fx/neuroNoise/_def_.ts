// Adapted from Paper Design's Neuro Noise (Apache-2.0; see LICENSE and NOTICE).
// Modified: evolving time, node colors/background and Glitch Studio sizing.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'neuroNoise',
	displayName: 'Neuro Noise',
	tags: [],
	primaryInputParameter: 'background',
	paramDefs: {
		background: { dataType: { kind: 'color' }, ui: { label: 'Background', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		colorFront: { dataType: { kind: 'color' }, ui: { label: 'Highlight Color', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		colorMid: { dataType: { kind: 'color' }, ui: { label: 'Main Color', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [71 / 255, 166 / 255, 1, 1] } },
		brightness: { dataType: { kind: 'scalar' }, ui: { label: 'Brightness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		contrast: { dataType: { kind: 'scalar' }, ui: { label: 'Contrast', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		scale: { dataType: { kind: 'scalar' }, ui: { label: 'Scale', control: { controlType: 'range', min: 0.01, max: 4, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		offset: { dataType: { kind: 'vector' }, ui: { label: 'Offset', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
