import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export const MAXIMUM_ORBIT_COUNT = 4096;
export const MAXIMUM_ITERATIONS = 2048;
export const MAXIMUM_BURN_IN = 2048;

export default defineNativeEffect({
	displayName: 'Clifford / De Jong Attractor',
	summary: {
		'ja-JP': 'Clifford・De Jongアトラクターから、煙や織物のような模様を生成します。',
		'en-US': 'Generates smoke-like or woven patterns from Clifford or De Jong attractors.',
	},
	kind: 'generate',
	thumbnail: { mode: 'customParameters', params: { densityResolution: '512' } },
	dependsOnRenderHistory: false,
	tags: ['pattern', 'fractal', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		formula: {
			dataType: { kind: 'enum', options: ['clifford', 'deJong'] },
			ui: { label: 'Formula', control: { labels: { clifford: 'Clifford', deJong: 'De Jong' } } },
			defaultValue: 'clifford',
		},
		a: {
			dataType: { kind: 'scalar' },
			ui: { label: 'A', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: -1.4,
		},
		b: {
			dataType: { kind: 'scalar' },
			ui: { label: 'B', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: 1.6,
		},
		c: {
			dataType: { kind: 'scalar' },
			ui: { label: 'C', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: 1,
		},
		d: {
			dataType: { kind: 'scalar' },
			ui: { label: 'D', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: 0.7,
		},
		scale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Scale', control: { controlType: 'range', min: 0.01, max: 1, step: 0.001 } },
			defaultValue: 0.2,
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: [0, 0],
		},
		exposure: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Exposure', control: { controlType: 'range', min: 0, max: 20, step: 0.01 } },
			defaultValue: 3,
		},
		gamma: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gamma', control: { controlType: 'range', min: 0.1, max: 4, step: 0.01 } },
			defaultValue: 1,
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Ramp', control: {} },
			defaultValue: {
				interpolation: 'linear',
				colorSpace: 'srgb',
				repeatCount: 1,
				repeatMode: 'wrap',
				stops: [
					{ id: 'empty', position: 0, color: [0, 0, 0, 0] },
					{ id: 'low', position: 0.2, color: srgbToLinearSrgb([0.1, 0.25, 0.6, 0.6]) },
					{ id: 'middle', position: 0.6, color: srgbToLinearSrgb([0.15, 0.75, 1, 1]) },
					{ id: 'high', position: 1, color: srgbToLinearSrgb([1, 0.9, 0.65, 1]) },
				],
			},
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
		},
		orbitCount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Orbit Count', control: { controlType: 'range', min: 1, max: MAXIMUM_ORBIT_COUNT, step: 1 } },
			defaultValue: 1024,
		},
		iterations: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Iterations', control: { controlType: 'range', min: 1, max: MAXIMUM_ITERATIONS, step: 1 } },
			defaultValue: 1024,
		},
		burnIn: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Burn In', control: { controlType: 'range', min: 0, max: MAXIMUM_BURN_IN, step: 1 } },
			defaultValue: 128,
		},
		densityResolution: {
			dataType: { kind: 'enum', options: ['256', '512', '1024', '2048'] },
			ui: { label: 'Density Resolution', control: { labels: { '256': '256', '512': '512', '1024': '1024', '2048': '2048' } } },
			defaultValue: '1024',
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		density: { dataType: { kind: 'scalar' },
			inputParameters: ['formula', 'a', 'b', 'c', 'd', 'scale', 'rotation', 'position', 'exposure', 'gamma', 'seed', 'orbitCount', 'iterations', 'burnIn', 'densityResolution'],
		},
	},
	primaryOutput: 'output',
});
