import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'text',
	displayName: 'Text',
	description: {
		'ja-JP': '指定したフォントや色で文字を描画します。',
		'en-US': 'Draws text using the specified font and color.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['typography'],
	paramDefs: {
		text: { dataType: { kind: 'string' }, ui: { label: 'Text', control: {} }, defaultValue: { inputSource: 'literal', value: 'Hello, world!' } },
		font: { dataType: { kind: 'assetReference', assetType: 'font' }, ui: { label: 'Font', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		size: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Size (Height Ratio)',
				control: {
					controlType: 'range',
					min: 0.0001,
					max: 1,
					step: 0.01,
					logarithmic: true,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		overflow: {
			dataType: { kind: 'enum', options: ['none', 'shrink', 'compress'] },
			ui: { label: 'Overflow', control: { labels: { none: 'Do Nothing', shrink: 'Shrink Font Size', compress: 'Compress Horizontally' } } },
			defaultValue: { inputSource: 'literal', value: 'compress' },
		},
		maxWidth: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Max Width (Width Ratio)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		color: {
			dataType: { kind: 'color' },
			ui: { label: 'Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
			canNode: true,
		},
		outlineWidth: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Outline Width (Size Ratio)',
				control: {
					controlType: 'range',
					min: 0,
					max: 0.25,
					step: 0.005,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		outlineColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Outline Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] },
			canNode: true,
		},
		shadowEnabled: { dataType: { kind: 'bool' }, ui: { label: 'Drop Shadow', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		shadowColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Shadow Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0.5] },
			canNode: true,
		},
		shadowOffset: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Shadow Offset (Size Ratio)',
				control: {
					controlType: 'vector',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0.1, -0.1] },
		},
		shadowBlur: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Shadow Blur (Size Ratio)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		position: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Position',
				control: {
					controlType: 'xy',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		align: {
			dataType: { kind: 'enum', options: ['left', 'center', 'right'] },
			ui: { label: 'Alignment', control: { labels: { left: 'Left', center: 'Center', right: 'Right' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		lineHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Line Height (Size Ratio)', control: { controlType: 'range', min: 0, max: 3 } },
			defaultValue: { inputSource: 'literal', value: 1.2 },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
