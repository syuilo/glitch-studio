// Adapted from Paper Design's Liquid Metal (Apache-2.0; see ../../../renderer/src/effect-implementations/liquidMetal/LICENSE).
// Modified for WebGPU and live node inputs; no uploaded-image or shape selector.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'liquidMetal',
	displayName: 'Liquid Metal',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		colorBack: { type: 'color', label: 'Background color', default: () => ({ type: 'literal', value: [170 / 255, 170 / 255, 172 / 255, 0] }) },
		colorTint: { type: 'color', label: 'Tint color', default: () => ({ type: 'literal', value: [1, 1, 1, 1] }) },
		repetition: { type: 'range', label: 'Repetition', min: 1, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 2 }) },
		softness: { type: 'range', label: 'Softness', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.2 }) },
		shiftRed: { type: 'range', label: 'Shift red', min: -1, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.3 }) },
		shiftBlue: { type: 'range', label: 'Shift blue', min: -1, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.3 }) },
		distortion: { type: 'range', label: 'Distortion', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.07 }) },
		contour: { type: 'range', label: 'Contour', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		angle: { type: 'angle', label: 'Angle', default: () => ({ type: 'literal', value: 70 / 180 }) },
		time: { type: 'number', label: 'Time (s)', step: 0.01, default: () => ({ type: 'expression', expression: 'TIME' }) },
		speed: { type: 'number', label: 'Speed', step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		frame: { type: 'number', label: 'Frame offset (ms)', step: 1, default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
