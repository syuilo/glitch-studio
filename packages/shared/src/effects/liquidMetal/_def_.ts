// Adapted from Paper Design's Liquid Metal (Apache-2.0; see ../../../renderer/src/effect-implementations/liquidMetal/LICENSE).
// Modified for WebGPU and live node inputs; no uploaded-image or shape selector.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'liquidMetal',
	displayName: 'Liquid Metal',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		colorBack: { dataType: 'color', ui: { control: 'color' }, label: 'Background color', default: () => ({ inputSource: 'literal', value: [170 / 255, 170 / 255, 172 / 255, 0] }) },
		colorTint: { dataType: 'color', ui: { control: 'color' }, label: 'Tint color', default: () => ({ inputSource: 'literal', value: [1, 1, 1, 1] }) },
		repetition: { dataType: 'scalar', ui: { control: 'range', min: 1, max: 10, step: 0.01 }, label: 'Repetition', default: () => ({ inputSource: 'literal', value: 2 }) },
		softness: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Softness', default: () => ({ inputSource: 'literal', value: 0.2 }) },
		shiftRed: { dataType: 'scalar', ui: { control: 'range', min: -1, max: 1, step: 0.01 }, label: 'Shift red', default: () => ({ inputSource: 'literal', value: 0.3 }) },
		shiftBlue: { dataType: 'scalar', ui: { control: 'range', min: -1, max: 1, step: 0.01 }, label: 'Shift blue', default: () => ({ inputSource: 'literal', value: 0.3 }) },
		distortion: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Distortion', default: () => ({ inputSource: 'literal', value: 0.07 }) },
		contour: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Contour', default: () => ({ inputSource: 'literal', value: 1 }) },
		angle: { dataType: 'scalar', ui: { control: 'angle' }, label: 'Angle', default: () => ({ inputSource: 'literal', value: 70 / 180 }) },
		time: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Time (s)', default: () => ({ inputSource: 'envVariable', variable: 'TIME' }) },
		speed: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Speed', default: () => ({ inputSource: 'literal', value: 1 }) },
		frame: { dataType: 'scalar', ui: { control: 'number', step: 1 }, label: 'Frame offset (ms)', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
