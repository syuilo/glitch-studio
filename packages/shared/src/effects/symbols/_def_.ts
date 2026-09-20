import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'symbols',
	displayName: 'Symbols',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		iconset: { dataType: 'enum', ui: { control: 'enum' }, label: 'Iconset', options: [{
			value: 'symbols_numbers', label: 'Symbols + Numbers',
		}, {
			value: 'symbols', label: 'Symbols',
		}, {
			value: 'numbers', label: 'Numbers',
		}, {
			value: 'sweets', label: 'Sweets',
		}], default: () => ({ inputSource: 'literal', value: 'symbols' }) },
		highlightClipThreshold: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Highlight Clip Threshold', default: () => ({ inputSource: 'literal', value: 0.8 }) },
		shadowClipThreshold: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Shadow Clip Threshold', default: () => ({ inputSource: 'literal', value: 0.2 }) },
		divisions: { dataType: 'scalar', ui: { control: 'range', min: 8, max: 512, step: 1 }, label: 'Cell Divisions', default: () => ({ inputSource: 'literal', value: 64 }) },
		margin: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Cell Margin', default: () => ({ inputSource: 'literal', value: 0.25 }) },
		symbolTexturesRangeMin: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Symbol Textures Range Min', default: () => ({ inputSource: 'literal', value: 0 }) },
		symbolTexturesRangeMax: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Symbol Textures Range Max', default: () => ({ inputSource: 'literal', value: 1 }) },
		bgColor: { dataType: 'color', ui: { control: 'color' }, label: 'Background Color', default: () => ({ inputSource: 'literal', value: [0, 0, 0, 1] }) },
		colorA: { dataType: 'color', ui: { control: 'color' }, label: 'Color A', default: () => ({ inputSource: 'literal', value: [1, 1, 1, 1] }) },
		colorB: { dataType: 'color', ui: { control: 'color' }, label: 'Color B', default: () => ({ inputSource: 'literal', value: [0.8, 1, 0, 1] }) },
		colorC: { dataType: 'color', ui: { control: 'color' }, label: 'Color C', default: () => ({ inputSource: 'literal', value: [1, 0.3, 0, 1] }) },
		similarityThresholdFactor: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 32, step: 0.1 }, label: 'Similarity Threshold Factor', default: () => ({ inputSource: 'literal', value: 2 }) },
		forceField: { dataType: 'vector', ui: { control: 'vector', min: -1, max: 1 }, canNode: true, label: 'Force Field', default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		forceFieldShift: { dataType: 'bool', ui: { control: 'bool' }, label: 'Force Field Shift', default: () => ({ inputSource: 'literal', value: true }) },
		forceFieldWarp: { dataType: 'bool', ui: { control: 'bool' }, label: 'Force Field Warp', default: () => ({ inputSource: 'literal', value: true }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
