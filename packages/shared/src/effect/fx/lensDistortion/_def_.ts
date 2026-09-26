// Adapted from Paper Design's Lens Distortion (Apache-2.0; see LICENSE and NOTICE).
// Modified: node input and Glitch Studio angle units; noise and image transforms removed.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lensDistortion',
	displayName: 'Lens Distortion',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		spread: { dataType: { kind: 'scalar' }, ui: { label: 'Spread', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		bias: { dataType: { kind: 'scalar' }, ui: { label: 'Bias', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		perspective: { dataType: { kind: 'scalar' }, ui: { label: 'Perspective', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		count: { dataType: { kind: 'scalar' }, ui: { label: 'Samples', control: { controlType: 'range', min: 2, max: 50, step: 1 } }, defaultValue: { inputSource: 'literal', value: 35 } },
		dispersion: { dataType: { kind: 'scalar' }, ui: { label: 'Dispersion', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		dispersionShift: { dataType: { kind: 'scalar' }, ui: { label: 'Dispersion Shift', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		dispersionColor: { dataType: { kind: 'scalar' }, ui: { label: 'Dispersion Color', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		focusCenter: { dataType: { kind: 'scalar' }, ui: { label: 'Focus Center', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		focusEdges: { dataType: { kind: 'scalar' }, ui: { label: 'Focus Edges', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		swirl: { dataType: { kind: 'scalar' }, ui: { label: 'Swirl', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.35 } },
		lensBulge: { dataType: { kind: 'scalar' }, ui: { label: 'Lens Bulge', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		lensCircle: { dataType: { kind: 'scalar' }, ui: { label: 'Lens Circle', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		grainMixer: { dataType: { kind: 'scalar' }, ui: { label: 'Grain Mixer', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		grainOverlay: { dataType: { kind: 'scalar' }, ui: { label: 'Grain Overlay', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Spread Angle', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
