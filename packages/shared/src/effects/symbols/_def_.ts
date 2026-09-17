import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'symbols',
	displayName: 'Symbols',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		iconset: { type: 'enum', label: 'Iconset', options: [{
			value: 'symbols_numbers', label: 'Symbols + Numbers',
		}, {
			value: 'symbols', label: 'Symbols',
		}, {
			value: 'numbers', label: 'Numbers',
		}, {
			value: 'sweets', label: 'Sweets',
		}], default: () => ({ type: 'literal', value: 'symbols' }) },
		highlightClipThreshold: { type: 'range', label: 'Highlight Clip Threshold', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.8 }) },
		shadowClipThreshold: { type: 'range', label: 'Shadow Clip Threshold', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.2 }) },
		divisions: { type: 'range', min: 8, max: 512, step: 1, label: 'Cell Divisions', default: () => ({ type: 'literal', value: 64 }) },
		margin: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Cell Margin', default: () => ({ type: 'literal', value: 0.25 }) },
		symbolTexturesRangeMin: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Symbol Textures Range Min', default: () => ({ type: 'literal', value: 0 }) },
		symbolTexturesRangeMax: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Symbol Textures Range Max', default: () => ({ type: 'literal', value: 1 }) },
		bgColor: { type: 'color', label: 'Background Color', default: () => ({ type: 'literal', value: [0, 0, 0, 1] }) },
		colorA: { type: 'color', label: 'Color A', default: () => ({ type: 'literal', value: [1, 1, 1, 1] }) },
		colorB: { type: 'color', label: 'Color B', default: () => ({ type: 'literal', value: [0.8, 1, 0, 1] }) },
		colorC: { type: 'color', label: 'Color C', default: () => ({ type: 'literal', value: [1, 0.3, 0, 1] }) },
		similarityThresholdFactor: { type: 'range', min: 0, max: 32, step: 0.1, label: 'Similarity Threshold Factor', default: () => ({ type: 'literal', value: 2 }) },
		forceField: { type: 'vector', canNode: true, label: 'Force Field', min: -1, max: 1, default: () => ({ type: 'literal', value: [0, 0] }) },
		forceFieldShift: { type: 'bool', label: 'Force Field Shift', default: () => ({ type: 'literal', value: true }) },
		forceFieldWarp: { type: 'bool', label: 'Force Field Warp', default: () => ({ type: 'literal', value: true }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
