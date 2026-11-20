import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Flow Color',
	summary: {
		'ja-JP': 'ベクトル場と軌跡の強度から虹色の帯を作り、背景へ表示色空間で加算します。',
		'en-US': 'Adds phase-shifted RGB flow bands to the background in display color space.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'convert'],
	paramDefs: {
		background: {
			dataType: { kind: 'color' },
			ui: { label: 'Background', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0.45, 0.45, 0.45, 1] },
		},
		vector: {
			dataType: { kind: 'vector' },
			ui: { label: 'Vector', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		intensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Trail Intensity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		vectorScale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Vector Scale', control: { controlType: 'range', min: -4, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.64 },
		},
		intensityScale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Intensity Scale', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		frequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Frequency', control: { controlType: 'range', min: 0, max: 40, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 40 / (2 * Math.PI) },
		},
		phase: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Phase', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		channelPhase: {
			dataType: { kind: 'scalar' },
			ui: { label: 'RGB Phase Step', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 1 / (2 * Math.PI) },
		},
		brightness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Brightness', control: { controlType: 'range', min: 0, max: 50, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 12.5 },
		},
		opacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: 'background',
	resolutionInputParameters: ['background', 'vector', 'intensity', 'opacity'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
