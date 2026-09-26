// Adapted from Paper Design's Lens Distortion (Apache-2.0; see LICENSE and NOTICE).
// Modified: node input and Glitch Studio angle units; noise and image transforms removed.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lensDistortion',
	displayName: 'Lens Distortion',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		spread: { dataType: 'scalar', ui: { label: 'Spread', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		bias: { dataType: 'scalar', ui: { label: 'Bias', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		perspective: { dataType: 'scalar', ui: { label: 'Perspective', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		count: { dataType: 'scalar', ui: { label: 'Samples', control: 'range', min: 2, max: 50, step: 1 }, defaultValue: { inputSource: 'literal', value: 35 } },
		dispersion: { dataType: 'scalar', ui: { label: 'Dispersion', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		dispersionShift: { dataType: 'scalar', ui: { label: 'Dispersion Shift', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		dispersionColor: { dataType: 'scalar', ui: { label: 'Dispersion Color', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		focusCenter: { dataType: 'scalar', ui: { label: 'Focus Center', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		focusEdges: { dataType: 'scalar', ui: { label: 'Focus Edges', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		swirl: { dataType: 'scalar', ui: { label: 'Swirl', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.35 } },
		lensBulge: { dataType: 'scalar', ui: { label: 'Lens Bulge', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		lensCircle: { dataType: 'scalar', ui: { label: 'Lens Circle', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		grainMixer: { dataType: 'scalar', ui: { label: 'Grain Mixer', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		grainOverlay: { dataType: 'scalar', ui: { label: 'Grain Overlay', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		angle: { dataType: 'scalar', ui: { label: 'Spread Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
