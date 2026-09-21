import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'symbols',
	displayName: 'Symbols',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		iconset: { dataType: 'enum', ui: { label: 'Iconset', control: 'enum' }, options: [{
			value: 'symbols_numbers', label: 'Symbols + Numbers',
		}, {
			value: 'symbols', label: 'Symbols',
		}, {
			value: 'numbers', label: 'Numbers',
		}, {
			value: 'sweets', label: 'Sweets',
		}], defaultValue: { inputSource: 'literal', value: 'symbols' } },
		highlightClipThreshold: { dataType: 'scalar', ui: { label: 'Highlight Clip Threshold', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		shadowClipThreshold: { dataType: 'scalar', ui: { label: 'Shadow Clip Threshold', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		divisions: { dataType: 'scalar', ui: { label: 'Cell Divisions', control: 'range', min: 8, max: 512, step: 1 }, defaultValue: { inputSource: 'literal', value: 64 } },
		margin: { dataType: 'scalar', ui: { label: 'Cell Margin', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.25 } },
		symbolTexturesRangeMin: { dataType: 'scalar', ui: { label: 'Symbol Textures Range Min', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		symbolTexturesRangeMax: { dataType: 'scalar', ui: { label: 'Symbol Textures Range Max', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		bgColor: { dataType: 'color', ui: { label: 'Background Color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		colorA: { dataType: 'color', ui: { label: 'Color A', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		colorB: { dataType: 'color', ui: { label: 'Color B', control: 'color' }, defaultValue: { inputSource: 'literal', value: [0.8, 1, 0, 1] } },
		colorC: { dataType: 'color', ui: { label: 'Color C', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 0.3, 0, 1] } },
		similarityThresholdFactor: { dataType: 'scalar', ui: { label: 'Similarity Threshold Factor', control: 'range', min: 0, max: 32, step: 0.1 }, defaultValue: { inputSource: 'literal', value: 2 } },
		forceField: { dataType: 'vector', ui: { label: 'Force Field', control: 'vector', min: -1, max: 1 }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		forceFieldShift: { dataType: 'bool', ui: { label: 'Force Field Shift', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
		forceFieldWarp: { dataType: 'bool', ui: { label: 'Force Field Warp', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
