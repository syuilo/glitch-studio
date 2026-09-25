// Adapted from Paper Design's Water (Apache-2.0; see ../../../renderer/src/effect-implementations/water/LICENSE).
// Modified for WebGPU node inputs, without background or image layout controls.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'water',
	displayName: 'Water',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		colorHighlight: { dataType: 'color', ui: { label: 'Highlight color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		colorHighlightAlpha: { dataType: 'scalar', ui: { label: 'Highlight alpha', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		highlights: { dataType: 'scalar', ui: { label: 'Highlights', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.07 } },
		layering: { dataType: 'scalar', ui: { label: 'Layering', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		edges: { dataType: 'scalar', ui: { label: 'Edges', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		waves: { dataType: 'scalar', ui: { label: 'Waves', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		caustic: { dataType: 'scalar', ui: { label: 'Caustic', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		size: { dataType: 'scalar', ui: { label: 'Size', control: 'range', min: 0.01, max: 7, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		time: { dataType: 'scalar', ui: { label: 'Time (s)', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'envVariable', variable: 'TIME' } },
		speed: { dataType: 'scalar', ui: { label: 'Speed', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		frame: { dataType: 'scalar', ui: { label: 'Frame offset (ms)', control: 'number', step: 1 }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
