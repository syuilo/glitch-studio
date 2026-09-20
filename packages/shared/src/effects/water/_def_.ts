// Adapted from Paper Design's Water (Apache-2.0; see ../../../renderer/src/effect-implementations/water/LICENSE).
// Modified for WebGPU node inputs, without background or image layout controls.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'water',
	displayName: 'Water',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		colorHighlight: { dataType: 'color', ui: { control: 'color' }, label: 'Highlight color', default: () => ({ inputSource: 'literal', value: [1, 1, 1, 1] }) },
		colorHighlightAlpha: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Highlight alpha', default: () => ({ inputSource: 'literal', value: 1 }) },
		highlights: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Highlights', default: () => ({ inputSource: 'literal', value: 0.07 }) },
		layering: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Layering', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		edges: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Edges', default: () => ({ inputSource: 'literal', value: 0.8 }) },
		waves: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Waves', default: () => ({ inputSource: 'literal', value: 0.3 }) },
		caustic: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Caustic', default: () => ({ inputSource: 'literal', value: 0.1 }) },
		size: { dataType: 'scalar', ui: { control: 'range', min: 0.01, max: 7, step: 0.01 }, label: 'Size', default: () => ({ inputSource: 'literal', value: 1 }) },
		time: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Time (s)', default: () => ({ inputSource: 'envVariable', variable: 'TIME' }) },
		speed: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Speed', default: () => ({ inputSource: 'literal', value: 1 }) },
		frame: { dataType: 'scalar', ui: { control: 'number', step: 1 }, label: 'Frame offset (ms)', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
