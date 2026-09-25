// Adapted from Paper Design's Liquid Metal (Apache-2.0; see ../../../renderer/src/effect-implementations/liquidMetal/LICENSE).
// Modified for WebGPU and live node inputs; no uploaded-image or shape selector.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'liquidMetal',
	displayName: 'Liquid Metal',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		colorBack: { dataType: 'color', ui: { label: 'Background color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [170 / 255, 170 / 255, 172 / 255, 0] } },
		colorTint: { dataType: 'color', ui: { label: 'Tint color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		repetition: { dataType: 'scalar', ui: { label: 'Repetition', control: 'range', min: 1, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 2 } },
		softness: { dataType: 'scalar', ui: { label: 'Softness', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		shiftRed: { dataType: 'scalar', ui: { label: 'Shift red', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		shiftBlue: { dataType: 'scalar', ui: { label: 'Shift blue', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		distortion: { dataType: 'scalar', ui: { label: 'Distortion', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.07 } },
		contour: { dataType: 'scalar', ui: { label: 'Contour', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 70 / 180 } },
		time: { dataType: 'scalar', ui: { label: 'Time', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		speed: { dataType: 'scalar', ui: { label: 'Speed', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		frame: { dataType: 'scalar', ui: { label: 'Frame offset (ms)', control: 'number', step: 1 }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
