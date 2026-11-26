import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Shape SDF',
	summary: {
		'ja-JP': '楕円や角丸矩形の符号付き距離場を生成します。',
		'en-US': 'Generates a signed distance field for an ellipse or rounded rectangle.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'math', 'sdf'],
	thumbnail: { mode: 'none' },
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		shape: {
			dataType: { kind: 'enum', options: ['ellipse', 'rectangle'] },
			ui: { label: 'Shape', control: { labels: { ellipse: 'Ellipse', rectangle: 'Rectangle' } } },
			defaultValue: 'ellipse',
		},
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: [0, 0],
		},
		size: {
			dataType: { kind: 'vector' },
			ui: { label: 'Size (Reference Ratio)', control: { controlType: 'dimension', min: 0, max: 2, step: 0.01 } },
			defaultValue: [0.5, 0.5],
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
		cornerRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Corner Radius (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: 0,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
