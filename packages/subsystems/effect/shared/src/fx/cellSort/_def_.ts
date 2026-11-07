import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'cellSort',
	displayName: 'Cell Sort',
	description: {
		'ja-JP': '入力画像をセルに分割し、セルの平均色などを基準に画像片を並べ替えます。',
		'en-US': 'Splits the input into cells and sorts image fragments by their average color or a custom field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'pattern', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		frequency: {
			dataType: { kind: 'vector' },
			ui: { label: 'Frequency', control: { controlType: 'dimension', min: 0.01, max: 1000, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: [10, 10] },
		},
		// Cell Transformと同じく、Phaseの1は1セル分。正のYは上方向の格子座標へ加える。
		phase: {
			dataType: { kind: 'vector' },
			ui: { label: 'Phase', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		direction: {
			dataType: { kind: 'enum', options: ['horizontal', 'vertical'] },
			ui: { label: 'Direction', control: { labels: { horizontal: 'Horizontal', vertical: 'Vertical' } } },
			defaultValue: { inputSource: 'literal', value: 'horizontal' },
		},
		order: {
			dataType: { kind: 'enum', options: ['ascending', 'descending'] },
			ui: { label: 'Order', control: { labels: { ascending: 'Ascending', descending: 'Descending' } } },
			defaultValue: { inputSource: 'literal', value: 'ascending' },
		},
		sortBy: {
			dataType: { kind: 'enum', options: ['luminance', 'red', 'green', 'blue', 'alpha', 'saturation', 'custom'] },
			ui: { label: 'Sort By', control: { labels: { luminance: 'Luminance', red: 'Red', green: 'Green', blue: 'Blue', alpha: 'Alpha', saturation: 'Saturation', custom: 'Custom' } } },
			defaultValue: { inputSource: 'literal', value: 'luminance' },
		},
		customSortKey: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Custom Sort Key', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		thresholdMin: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Threshold Min', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		thresholdMax: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Threshold Max', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		samplesPerCell: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Samples Per Cell', control: { controlType: 'range', min: 1, max: 256, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 16 },
		},
		flattenMovedCells: {
			dataType: { kind: 'bool' },
			ui: { label: 'Average Color for Moved Cells', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
