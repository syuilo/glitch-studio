import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'gyroidGlow',
	displayName: 'Gyroid Glow',
	description: {
		'ja-JP': '入り組んだ発光する膜と、その中を移動する光の塊を生成します。',
		'en-US': 'Generates intricate luminous folds with a glowing orb moving through them.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'light', 'stylized', 'math'],
	paramDefs: {
		time: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Zoom', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		foldFrequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fold Frequency', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		foldAmount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fold Amount', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		sheetTilt: {
			dataType: { kind: 'vector' },
			ui: { label: 'Sheet Tilt', control: { controlType: 'vector', min: -4, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0.3, 0.9] },
		},
		glowWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Glow Width', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		sheetStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Sheet Strength', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		colorMode: {
			dataType: { kind: 'enum', options: ['cosine', 'colorRamp'] },
			ui: { label: 'Color Mode', control: { labels: { cosine: 'Cosine', colorRamp: 'Color Ramp' } } },
			defaultValue: { inputSource: 'literal', value: 'cosine' },
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Color Ramp', control: {} },
			defaultValue: { inputSource: 'literal', value: {
				interpolation: 'linear', colorSpace: 'linearSrgb', stops: [
					{ id: 'start', position: 0, color: srgbToLinearSrgb([0.2, 0.08, 0.8, 1]) },
					{ id: 'cyan', position: 0.25, color: srgbToLinearSrgb([0.03, 0.8, 1, 1]) },
					{ id: 'orange', position: 0.5, color: srgbToLinearSrgb([1, 0.4, 0.08, 1]) },
					{ id: 'pink', position: 0.75, color: srgbToLinearSrgb([1, 0.05, 0.35, 1]) },
					{ id: 'end', position: 1, color: srgbToLinearSrgb([0.2, 0.08, 0.8, 1]) },
				],
			} },
		},
		colorFrequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Frequency', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		colorPhase: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Phase', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		orbColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Orb Color', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		orbStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Orb Strength', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		exposure: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Exposure (EV)', control: { controlType: 'range', min: -10, max: 10, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		toneMapping: {
			dataType: { kind: 'enum', options: ['softShoulder', 'hdr'] },
			ui: { label: 'Tone Mapping', control: { labels: { softShoulder: 'Soft Shoulder', hdr: 'HDR' } } },
			defaultValue: { inputSource: 'literal', value: 'softShoulder' },
		},
		compositing: {
			dataType: { kind: 'enum', options: ['opaque', 'emission'] },
			ui: { label: 'Compositing', control: { labels: { opaque: 'Opaque', emission: 'Emission' } } },
			defaultValue: { inputSource: 'literal', value: 'opaque' },
		},
		maximumSteps: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Steps', control: { controlType: 'range', min: 1, max: 120, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 120 },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
