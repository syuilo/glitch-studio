import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'checker',
	displayName: 'Checker',
	description: {
		'ja-JP': '市松模様を描画します。',
		'en-US': 'Draws a checkerboard pattern.',
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
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	primaryInputParameter: 'background',
	resolutionInputParameter: 'background',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
