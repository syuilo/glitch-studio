// Adapted from Paper Design's Liquid Metal (Apache-2.0; see ../../../renderer/src/effect-implementations/liquidMetal/LICENSE).
// Modified for WebGPU and live node inputs; no uploaded-image or shape selector.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'liquidMetal',
	displayName: 'Liquid Metal',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		colorBack: { dataType: { kind: 'color' }, ui: { label: 'Background color', control: {} }, defaultValue: { inputSource: 'literal', value: [170 / 255, 170 / 255, 172 / 255, 0] } },
		colorTint: { dataType: { kind: 'color' }, ui: { label: 'Tint color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		repetition: { dataType: { kind: 'scalar' }, ui: { label: 'Repetition', control: { controlType: 'range', min: 1, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 2 } },
		softness: { dataType: { kind: 'scalar' }, ui: { label: 'Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		shiftRed: { dataType: { kind: 'scalar' }, ui: { label: 'Shift red', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		shiftBlue: { dataType: { kind: 'scalar' }, ui: { label: 'Shift blue', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		distortion: { dataType: { kind: 'scalar' }, ui: { label: 'Distortion', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.07 } },
		contour: { dataType: { kind: 'scalar' }, ui: { label: 'Contour', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 70 / 180 } },
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		speed: { dataType: { kind: 'scalar' }, ui: { label: 'Speed', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		frame: { dataType: { kind: 'scalar' }, ui: { label: 'Frame offset (ms)', control: { controlType: 'number', step: 1 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
