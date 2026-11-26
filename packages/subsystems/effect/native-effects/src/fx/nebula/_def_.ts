import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Nebula',
	summary: {
		'ja-JP': '立体的な雲の密度に沿って発光と吸収を計算し、流れる星雲を生成します。',
		'en-US': 'Generates a flowing nebula by integrating emission and absorption through a three-dimensional cloud.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	canHaveLongRunningRenderPass: true,
	tags: ['pattern', 'light', '3d'],
	thumbnail: { mode: 'defaultParameters' },
	paramDefs: {
		time: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } },
			defaultValue: 0,
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
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
			defaultValue: 1,
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center XY', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: [0, 0],
		},
		centerZ: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Center Z', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } },
			defaultValue: -1.2,
		},
		radius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Radius', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } },
			defaultValue: 1.5,
		},
		density: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Density', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: 6,
		},
		coverage: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Coverage', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.3,
		},
		noiseFrequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Noise Frequency', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: 1.8,
		},
		octaves: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Octaves', control: { controlType: 'range', min: 1, max: 6, step: 1 } },
			defaultValue: 5,
		},
		turbulence: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Turbulence', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: 1,
		},
		flow: {
			dataType: { kind: 'vector' },
			ui: { label: 'Flow XY', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			defaultValue: [0.04, 0.02],
		},
		flowZ: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Flow Z', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } },
			defaultValue: 0.02,
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Color Ramp', control: {} },
			defaultValue: {
				interpolation: 'linear', colorSpace: 'linearSrgb', repeatCount: 1, repeatMode: 'wrap', stops: [
					{ id: 'violet', position: 0, color: srgbToLinearSrgb([0.12, 0.025, 0.3, 1]) },
					{ id: 'magenta', position: 0.35, color: srgbToLinearSrgb([0.7, 0.08, 0.4, 1]) },
					{ id: 'cyan', position: 0.65, color: srgbToLinearSrgb([0.08, 0.65, 1, 1]) },
					{ id: 'warm', position: 1, color: srgbToLinearSrgb([1, 0.75, 0.4, 1]) },
				],
			},
		},
		colorOffset: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Offset', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } },
			defaultValue: 0,
		},
		emission: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Emission', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: 4,
		},
		absorption: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Absorption', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: 1.5,
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
			dataType: { kind: 'enum', options: ['volume', 'opaque', 'emission'] },
			ui: { label: 'Compositing', control: { labels: { volume: 'Volume', opaque: 'Opaque', emission: 'Emission' } } },
			defaultValue: 'volume',
		},
		stepSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Step Size', control: { controlType: 'range', min: 0.001, max: 0.1, logarithmic: true } },
			defaultValue: 0.025,
		},
		maximumSteps: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Steps', control: { controlType: 'range', min: 1, max: 2048, step: 1 } },
			defaultValue: 192,
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
