import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'QR Code',
	summary: {
		'ja-JP': '文字列からQRコードを生成します。',
		'en-US': 'Generates a QR code from text.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'typography', 'utility'],
	thumbnail: { mode: 'defaultParameters' },
	paramDefs: {
		content: { dataType: { kind: 'string' }, ui: { label: 'Content', control: {} }, defaultValue: 'Hello' },
		errorCorrection: {
			dataType: { kind: 'enum', options: ['L', 'M', 'Q', 'H'] },
			ui: { label: 'Error Correction', control: { labels: { L: 'L', M: 'M', Q: 'Q', H: 'H' } } },
			defaultValue: 'M',
		},
		version: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Version (0 = Auto)', control: { controlType: 'number', min: 0, max: 40, step: 1 } },
			defaultValue: 0,
		},
		quietZone: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Quiet Zone (Cells)', control: { controlType: 'number', min: 0, step: 1 } },
			defaultValue: 4,
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'shortSide' },
		darkColor: { dataType: { kind: 'color' }, ui: { label: 'Dark Color', control: {} }, canNode: true, defaultValue: [0, 0, 0, 1] },
		lightColor: { dataType: { kind: 'color' }, ui: { label: 'Light Color', control: {} }, canNode: true, defaultValue: [1, 1, 1, 1] },
		cellShape: {
			dataType: { kind: 'enum', options: ['square', 'rounded', 'circle', 'diamond', 'diagonalDown', 'diagonalUp'] },
			ui: { label: 'Cell Shape', control: { labels: { square: 'Square', rounded: 'Rounded Square', circle: 'Circle', diamond: 'Diamond', diagonalDown: 'Diagonal (↘)', diagonalUp: 'Diagonal (↗)' } } },
			defaultValue: 'square',
		},
		cellScale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Cell Scale', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 1,
		},
		roundness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Cell Roundness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.5,
		},
		cornerMode: {
			dataType: { kind: 'enum', options: ['individual', 'connected'] },
			ui: { label: 'Rounded Corners (Connected at Cell Scale 1)', control: { labels: { individual: 'Individual Cells', connected: 'Connected Cells' } } },
			defaultValue: 'individual',
		},
		finderFrameShape: {
			dataType: { kind: 'enum', options: ['square', 'rounded', 'circle'] },
			ui: { label: 'Frame Shape', control: { labels: { square: 'Square', rounded: 'Rounded Square', circle: 'Circle' } } },
			defaultValue: 'square',
		},
		finderFrameRoundness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Frame Roundness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.5,
		},
		finderFrameColor: { dataType: { kind: 'color' }, ui: { label: 'Frame Color', control: {} }, canNode: true, defaultValue: [0, 0, 0, 1] },
		finderCenterShape: {
			dataType: { kind: 'enum', options: ['square', 'rounded', 'circle'] },
			ui: { label: 'Center Shape', control: { labels: { square: 'Square', rounded: 'Rounded Square', circle: 'Circle' } } },
			defaultValue: 'square',
		},
		finderCenterRoundness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Center Roundness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.5,
		},
		finderCenterColor: { dataType: { kind: 'color' }, ui: { label: 'Center Color', control: {} }, canNode: true, defaultValue: [0, 0, 0, 1] },
		centerImageEnabled: { dataType: { kind: 'bool' }, ui: { label: 'Enable Center Image', control: {} }, defaultValue: false },
		centerImage: { dataType: { kind: 'color' }, ui: { label: 'Image', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] },
		centerImageSize: {
			dataType: { kind: 'vector' },
			ui: { label: 'Image Size (QR Code Body Ratio)', control: { controlType: 'dimension', min: 0, max: 1, step: 0.01 } },
			defaultValue: [0.2, 0.2],
		},
		centerImagePadding: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Image Padding (Cells)', control: { controlType: 'range', min: 0, max: 4, step: 0.1 } },
			defaultValue: 1,
		},
		antiAlias: { dataType: { kind: 'bool' }, ui: { label: 'Anti-alias', control: {} }, defaultValue: true },
	},
	ui: {
		parameterLayout: [
			'content', 'errorCorrection', 'version', 'quietZone', 'sizeReference',
			{ type: 'section', id: 'cells', label: 'Cells', children: ['darkColor', 'lightColor', 'cellShape', 'cellScale', 'roundness', 'cornerMode'] },
			{ type: 'section', id: 'finderPatterns', label: 'Finder Patterns', defaultExpanded: false, children: ['finderFrameShape', 'finderFrameRoundness', 'finderFrameColor', 'finderCenterShape', 'finderCenterRoundness', 'finderCenterColor'] },
			{ type: 'section', id: 'centerImage', label: 'Center Image', defaultExpanded: false, children: ['centerImageEnabled', 'centerImage', 'centerImageSize', 'centerImagePadding'] },
			'antiAlias',
		],
	},
	// 中央画像はQRコードの配置寸法や解像度の基準ではない。出力は既存の解像度設定に従う。
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
