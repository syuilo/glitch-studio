import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'polkadot',
	displayName: 'Polka dot',
	description: {
		'ja-JP': '水玉模様を描画します。',
		'en-US': 'Draws a polka dot pattern.',
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
		majorRadius: { dataType: { kind: 'scalar' }, ui: { label: 'Major radius', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		majorColor: { dataType: { kind: 'color' }, ui: { label: 'Major color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.75] } },
		minorDivisions: { dataType: { kind: 'scalar' }, ui: { label: 'Minor divisions', control: { controlType: 'range', min: 0, max: 16, step: 1 } }, defaultValue: { inputSource: 'literal', value: 4 } },
		minorRadius: { dataType: { kind: 'scalar' }, ui: { label: 'Minor radius', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.25 } },
		minorColor: { dataType: { kind: 'color' }, ui: { label: 'Minor color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	primaryInputParameter: 'background',
	resolutionInputParameter: 'background',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
