import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Gyroid Bubbles',
	summary: {
		'ja-JP': 'うねる発光膜を持ち、近づくと溶け合う立体的な泡を生成します。',
		'en-US': 'Generates luminous, rippling 3D bubbles that merge as they approach each other.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['light', 'liquid', '3d'],
	paramDefs: {
		time: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } },
			defaultValue: 0,
		},
		count: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Count', control: { controlType: 'range', min: 1, max: 12, step: 1 } },
			defaultValue: 6,
		},
		radius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Radius', control: { controlType: 'range', min: 0.02, max: 0.5, step: 0.001 } },
			defaultValue: 0.14,
		},
		spacing: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Spacing', control: { controlType: 'range', min: 0, max: 3, step: 0.01 } },
			defaultValue: 1,
		},
		mergeWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Merge Width', control: { controlType: 'range', min: 0, max: 0.3, step: 0.001 } },
			defaultValue: 0.08,
		},
		surfaceDeformation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Surface Deformation', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.25,
		},
		detailFrequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Detail Frequency', control: { controlType: 'range', min: 0.25, max: 4, logarithmic: true } },
			defaultValue: 1,
		},
		glowWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Glow Width', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: 0.008,
		},
		glowStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Glow Strength', control: { controlType: 'range', min: 0, max: 8, step: 0.01 } },
			defaultValue: 1,
		},
		cameraPosition: {
			dataType: { kind: 'vector' },
			ui: { label: 'Camera XY', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: [0, 0],
		},
		cameraZ: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Camera Z', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } },
			defaultValue: 0.8,
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Zoom', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: 0.78,
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
		colorMode: {
			dataType: { kind: 'enum', options: ['cosine', 'colorRamp'] },
			ui: { label: 'Color Mode', control: { labels: { cosine: 'Cosine', colorRamp: 'Color Ramp' } } },
			defaultValue: 'cosine',
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Color Ramp', control: {} },
			defaultValue: {
				interpolation: 'linear', colorSpace: 'linearSrgb', repeatCount: 1, repeatMode: 'wrap', stops: [
					{ id: 'violet', position: 0, color: srgbToLinearSrgb([0.51, 0.22, 1, 1]) },
					{ id: 'cyan', position: 0.25, color: srgbToLinearSrgb([0.08, 0.83, 1, 1]) },
					{ id: 'gold', position: 0.5, color: srgbToLinearSrgb([1, 0.68, 0.23, 1]) },
					{ id: 'pink', position: 0.75, color: srgbToLinearSrgb([1, 0.23, 0.63, 1]) },
					{ id: 'end', position: 1, color: srgbToLinearSrgb([0.51, 0.22, 1, 1]) },
				],
			},
		},
		colorFrequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Frequency', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: 1,
		},
		colorPhase: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Phase', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: 0,
		},
		exposure: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Exposure (EV)', control: { controlType: 'range', min: -10, max: 10, step: 0.1 } },
			defaultValue: 0,
		},
		toneMapping: {
			dataType: { kind: 'enum', options: ['softShoulder', 'hdr'] },
			ui: { label: 'Tone Mapping', control: { labels: { softShoulder: 'Soft Shoulder', hdr: 'HDR' } } },
			defaultValue: 'softShoulder',
		},
		compositing: {
			dataType: { kind: 'enum', options: ['opaque', 'emission'] },
			ui: { label: 'Compositing', control: { labels: { opaque: 'Opaque', emission: 'Emission' } } },
			defaultValue: 'opaque',
		},
		maximumSteps: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Steps', control: { controlType: 'range', min: 1, max: 1024, step: 1 } },
			defaultValue: 256,
		},
		maximumTraceDistance: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Trace Distance', control: { controlType: 'range', min: 0, max: 30, step: 0.01 } },
			defaultValue: 7,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
