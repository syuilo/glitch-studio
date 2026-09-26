import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'symbols',
	displayName: 'Symbols',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		iconset: {
			dataType: { kind: 'enum', options: ['symbols_numbers', 'symbols', 'numbers', 'sweets'] },
			ui: { label: 'Iconset', control: { labels: { 'symbols_numbers': 'Symbols + Numbers', 'symbols': 'Symbols', 'numbers': 'Numbers', 'sweets': 'Sweets' } } },
			defaultValue: { inputSource: 'literal', value: 'symbols' },
		},
		highlightClipThreshold: { dataType: { kind: 'scalar' }, ui: { label: 'Highlight Clip Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		shadowClipThreshold: { dataType: { kind: 'scalar' }, ui: { label: 'Shadow Clip Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		divisions: { dataType: { kind: 'scalar' }, ui: { label: 'Cell Divisions', control: { controlType: 'range', min: 8, max: 512, step: 1 } }, defaultValue: { inputSource: 'literal', value: 64 } },
		margin: { dataType: { kind: 'scalar' }, ui: { label: 'Cell Margin', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.25 } },
		symbolTexturesRangeMin: { dataType: { kind: 'scalar' }, ui: { label: 'Symbol Textures Range Min', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		symbolTexturesRangeMax: { dataType: { kind: 'scalar' }, ui: { label: 'Symbol Textures Range Max', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		bgColor: { dataType: { kind: 'color' }, ui: { label: 'Background Color', control: {} }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		colorA: { dataType: { kind: 'color' }, ui: { label: 'Color A', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		colorB: { dataType: { kind: 'color' }, ui: { label: 'Color B', control: {} }, defaultValue: { inputSource: 'literal', value: [0.8, 1, 0, 1] } },
		colorC: { dataType: { kind: 'color' }, ui: { label: 'Color C', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 0.3, 0, 1] } },
		similarityThresholdFactor: { dataType: { kind: 'scalar' }, ui: { label: 'Similarity Threshold Factor', control: { controlType: 'range', min: 0, max: 32, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 2 } },
		forceField: { dataType: { kind: 'vector' }, ui: { label: 'Force Field', control: { controlType: 'vector', min: -1, max: 1 } }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		forceFieldShift: { dataType: { kind: 'bool' }, ui: { label: 'Force Field Shift', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		forceFieldWarp: { dataType: { kind: 'bool' }, ui: { label: 'Force Field Warp', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
