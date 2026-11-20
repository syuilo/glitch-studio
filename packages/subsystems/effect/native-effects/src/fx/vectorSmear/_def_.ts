import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Vector Smear',
	summary: {
		'ja-JP': 'ベクトル場と強度に沿って画像を片側へ引き伸ばします。',
		'en-US': 'Smears an image in one direction along a vector field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'blur'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		vector: {
			dataType: { kind: 'vector' },
			ui: { label: 'Vector', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		intensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Intensity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Amount', control: { controlType: 'range', min: -0.1, max: 0.1, step: 0.0001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.01 },
		},
		vectorOffset: {
			dataType: { kind: 'vector' },
			ui: { label: 'Vector Offset', isAdvanced: true, control: { controlType: 'vector', min: -0.1, max: 0.1, step: 0.0001 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		jitter: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Jitter', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input', 'vector', 'intensity', 'amount'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
