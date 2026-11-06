import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'textPattern',
	displayName: 'Text Pattern',
	description: {
		'ja-JP': '文字列を繰り返し配置し、文字ごとに動きや色の変化を加えた模様を作ります。',
		'en-US': 'Repeats text to create patterns with motion and color variation for each character.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['typography', 'pattern'],
	staticSettingDefs: {
		font: { dataType: { kind: 'assetReference', assetType: 'font' }, ui: { label: 'Font' }, defaultValue: null },
	},
	paramDefs: {
		text: { dataType: { kind: 'string' }, ui: { label: 'Text', control: {} }, defaultValue: { inputSource: 'literal', value: 'TOGETHER' } },
		size: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Size (Reference Ratio)', control: { controlType: 'range', min: 0.0001, max: 1, step: 0.01, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		repetitions: {
			dataType: { kind: 'vector' },
			ui: { label: 'Repetitions', control: { controlType: 'dimension', min: 1, max: 1000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: [3, 12] },
		},
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		align: {
			dataType: { kind: 'enum', options: ['left', 'center', 'right', 'distribute'] },
			ui: { label: 'Alignment', control: { labels: { left: 'Left', center: 'Center', right: 'Right', distribute: 'Distribute' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		lineHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Line Height (Size Ratio)', control: { controlType: 'range', min: 0, max: 3, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1.2 },
		},
		tracking: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Tracking (Size Ratio)', control: { controlType: 'range', min: -1, max: 2, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		translation: {
			dataType: { kind: 'vector' },
			ui: { label: 'Translation', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		opacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		scale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Scale', control: { controlType: 'range', min: -4, max: 4, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		color: {
			dataType: { kind: 'color' },
			ui: { label: 'Color', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
