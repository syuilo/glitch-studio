import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Text',
	summary: {
		'ja-JP': '指定したフォントや色で文字を描画します。',
		'en-US': 'Draws text using the specified font and color.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['typography'],
	staticSettingDefs: {
		font: { dataType: { kind: 'assetReference', assetType: 'font' }, ui: { label: 'Font' }, defaultValue: null },
	},
	paramDefs: {
		text: { dataType: { kind: 'string' }, ui: { label: 'Text', control: {} }, defaultValue: 'Hello, world!' },
		writingMode: {
			dataType: { kind: 'enum', options: ['horizontal-tb', 'vertical-rl'] },
			ui: { label: 'Writing Mode', control: { labels: { 'horizontal-tb': 'Horizontal', 'vertical-rl': 'Vertical (right to left)' } } },
			defaultValue: 'horizontal-tb',
		},
		size: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Size (Reference Ratio)',
				control: {
					controlType: 'range',
					min: 0.0001,
					max: 1,
					step: 0.01,
					logarithmic: true,
				},
			},
			defaultValue: 0.1,
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		overflow: {
			dataType: { kind: 'enum', options: ['none', 'shrink', 'compress'] },
			ui: { label: 'Overflow', control: { labels: { none: 'Do Nothing', shrink: 'Shrink Font Size', compress: 'Compress Along Writing Direction' } } },
			defaultValue: 'compress',
		},
		maxWidth: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Max Width (Width Ratio, Horizontal)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		maxHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Max Height (Height Ratio, Vertical)', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 1,
		},
		color: {
			dataType: { kind: 'color' },
			ui: { label: 'Color', control: {} },
			defaultValue: [1, 1, 1, 1],
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
			defaultValue: 0,
		},
		outlineColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Outline Color', control: {} },
			defaultValue: [0, 0, 0, 1],
			canNode: true,
		},
		shadowEnabled: { dataType: { kind: 'bool' }, ui: { label: 'Drop Shadow', control: {} }, defaultValue: false },
		shadowColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Shadow Color', control: {} },
			defaultValue: [0, 0, 0, 0.5],
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
			defaultValue: [0.1, -0.1],
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
			defaultValue: 0.1,
		},
		position: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Position',
				control: {
					controlType: 'xy',
					min: -0.5,
					max: 0.5,
					step: 0.01,
				},
			},
			defaultValue: [0, 0],
		},
		align: {
			dataType: { kind: 'enum', options: ['left', 'center', 'right'] },
			ui: { label: 'Alignment', control: { labels: { left: 'Left / Top', center: 'Center', right: 'Right / Bottom' } } },
			defaultValue: 'center',
		},
		lineHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Line / Column Spacing (Size Ratio)', control: { controlType: 'range', min: 0, max: 3 } },
			defaultValue: 1.2,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
