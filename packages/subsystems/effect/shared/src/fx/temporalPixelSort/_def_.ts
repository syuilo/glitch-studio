import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'temporalPixelSort',
	displayName: 'Temporal Pixel Sort',
	description: {
		'ja-JP': '位置ごとに現在と過去の入力画素を明るさなどで並べ替え、Rankで指定した順位の色を表示します。Rankは0で先頭、1で末尾です。描画履歴に依存します。',
		'en-US': 'Sorts current and historical input pixels at each position by brightness or another key, then selects a color by Rank: 0 selects the first, 1 the last. Depends on render history.',
	},
	kind: 'modify',
	dependsOnRenderHistory: true,
	tags: ['glitch', 'temporal', 'pixel', 'color'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		rank: { dataType: { kind: 'scalar' }, ui: { label: 'Rank', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.5 } },
		sortBy: {
			dataType: { kind: 'enum', options: ['luminance', 'red', 'green', 'blue', 'alpha', 'saturation'] },
			ui: { label: 'Sort By', control: { labels: { luminance: 'Luminance', red: 'Red', green: 'Green', blue: 'Blue', alpha: 'Alpha', saturation: 'Saturation' } } },
			defaultValue: { inputSource: 'literal', value: 'luminance' },
		},
		order: {
			dataType: { kind: 'enum', options: ['ascending', 'descending'] },
			ui: { label: 'Order', control: { labels: { ascending: 'Ascending', descending: 'Descending' } } },
			defaultValue: { inputSource: 'literal', value: 'ascending' },
		},
		interpolateRanks: { dataType: { kind: 'bool' }, ui: { label: 'Interpolate Ranks', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		ignoreTransparent: { dataType: { kind: 'bool' }, ui: { label: 'Ignore Fully Transparent Samples', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		historyFrames: { dataType: { kind: 'scalar' }, ui: { label: 'History Frames', control: { controlType: 'range', min: 2, max: 64, step: 1 } }, defaultValue: { inputSource: 'literal', value: 8 } },
		historyDuration: { dataType: { kind: 'scalar' }, ui: { label: 'History Window (ms)', control: { controlType: 'range', min: 0, max: 2000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 500 } },
		historyScale: { dataType: { kind: 'scalar' }, ui: { label: 'History Resolution (%)', control: { controlType: 'range', min: 10, max: 100, step: 1 } }, defaultValue: { inputSource: 'literal', value: 100 } },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset History', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
