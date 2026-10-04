import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'hexGrid',
	displayName: 'Hex grid',
	description: {
		'ja-JP': '六角形の格子模様を描画します。',
		'en-US': 'Draws a hexagonal grid pattern.',
	},
	kind: 'generate',
	tags: ['pattern'],
	paramDefs: {
		background: { dataType: { kind: 'color' }, ui: { label: 'Background', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		density: {
			dataType: { kind: 'vector' },
			ui: { label: 'Density', control: { controlType: 'vector', min: 1, max: 1000, logarithmic: true } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [3, 3] },
		},
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		lineWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Line width', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.036 } },
		lineColor: { dataType: { kind: 'color' }, ui: { label: 'Line color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.75] } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	primaryInputParameter: 'background',
	resolutionInputParameter: 'background',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
