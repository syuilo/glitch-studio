import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'waveDistort',
	displayName: 'Wave Distort',
	description: {
		'ja-JP': '正弦波に沿って入力画像を任意の方向に歪めます。',
		'en-US': 'Distorts the input image along a sine wave in any direction.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion'],
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
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
