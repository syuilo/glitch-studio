import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'textPattern',
	displayName: 'Text Pattern',
	description: {
		'ja-JP': '文字列を反復配置し、各文字の位置・透明度・大きさ・回転・色を入力で変化させます。',
		'en-US': 'Repeats text and controls each character’s position, opacity, scale, rotation, and color using inputs.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['typography', 'pattern'],
	paramDefs: {
		text: { dataType: { kind: 'string' }, ui: { label: 'Text', control: {} }, defaultValue: { inputSource: 'literal', value: 'TOGETHER' } },
		font: { dataType: { kind: 'assetReference', assetType: 'font' }, ui: { label: 'Font', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		size: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Size (Height Ratio)', control: { controlType: 'range', min: 0.0001, max: 1, step: 0.01, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		repetitions: {
			dataType: { kind: 'vector' },
			ui: { label: 'Repetitions', control: { controlType: 'dimension', min: 1, max: 1000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: [3, 12] },
		},
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -1, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		align: {
			dataType: { kind: 'enum', options: ['left', 'center', 'right'] },
			ui: { label: 'Alignment', control: { labels: { left: 'Left', center: 'Center', right: 'Right' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		lineHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Line Height (Size Ratio)', control: { controlType: 'range', min: 0, max: 3, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1.2 },
		},
		translation: {
			dataType: { kind: 'vector' },
			ui: { label: 'Translation', control: { controlType: 'vector', min: -2, max: 2, step: 0.01 } },
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
	resolutionInputParameter: null,
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
