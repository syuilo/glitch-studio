// Adapted from Paper Design's Water (Apache-2.0; see ../../../renderer/src/fx-implementations/water/LICENSE).
// Modified for WebGPU node inputs, without background or image layout controls.
import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'water',
	displayName: 'Water',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		colorHighlight: { type: 'color', label: 'Highlight color', default: () => ({ type: 'literal', value: [1, 1, 1, 1] }) },
		colorHighlightAlpha: { type: 'range', label: 'Highlight alpha', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		highlights: { type: 'range', label: 'Highlights', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.07 }) },
		layering: { type: 'range', label: 'Layering', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.5 }) },
		edges: { type: 'range', label: 'Edges', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.8 }) },
		waves: { type: 'range', label: 'Waves', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.3 }) },
		caustic: { type: 'range', label: 'Caustic', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.1 }) },
		size: { type: 'range', label: 'Size', min: 0.01, max: 7, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		time: { type: 'number', label: 'Time (s)', step: 0.01, default: () => ({ type: 'expression', expression: 'TIME' }) },
		speed: { type: 'number', label: 'Speed', step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		frame: { type: 'number', label: 'Frame offset (ms)', step: 1, default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
