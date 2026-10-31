import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'sineWaveWarp',
	displayName: 'Sine Wave Warp',
	description: {
		'ja-JP': '正弦波に沿って入力画像を任意の方向に歪め、変位に応じた色収差を加えます。',
		'en-US': 'Warps the input image along a sine wave in any direction, with optional chromatic aberration proportional to the displacement.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'color'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		direction: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Direction', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		phase: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Phase', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		frequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Frequency',
				control: {
					controlType: 'range',
					min: 0,
					max: 100,
					step: 0.1,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 5 },
		},
		amplitude: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Amplitude',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		chromaticAberrationStrength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Chromatic Aberration Strength',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		chromaticAberrationSamples: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Chromatic Aberration Samples',
				control: {
					controlType: 'number',
					min: 3,
					max: 64,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 16 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
