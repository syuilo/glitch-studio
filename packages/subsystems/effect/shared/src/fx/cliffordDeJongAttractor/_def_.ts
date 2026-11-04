import { defineEffect } from '../../effect-definition.ts';

export const MAXIMUM_ORBIT_COUNT = 4096;
export const MAXIMUM_ITERATIONS = 2048;
export const MAXIMUM_BURN_IN = 2048;

export default defineEffect({
	id: 'cliffordDeJongAttractor',
	displayName: 'Clifford / De Jong Attractor',
	description: {
		'ja-JP': 'Clifford・De Jongアトラクターの点密度から、煙や織物のような模様を生成します。A〜Dで形を変更します。DensityはExposure・Gammaを適用した0〜1の密度です。位置は長辺全体=1の共通単位で、描画履歴には依存しません。',
		'en-US': 'Generates smoke-like or woven patterns from Clifford or De Jong attractor point density. A–D control the shape. Density is mapped to 0–1 using Exposure and Gamma. Position uses one full render long side. Does not depend on render history.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		formula: {
			dataType: { kind: 'enum', options: ['clifford', 'deJong'] },
			ui: { label: 'Formula', control: { labels: { clifford: 'Clifford', deJong: 'De Jong' } } },
			defaultValue: { inputSource: 'literal', value: 'clifford' },
		},
		a: {
			dataType: { kind: 'scalar' },
			ui: { label: 'A', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: -1.4 },
		},
		b: {
			dataType: { kind: 'scalar' },
			ui: { label: 'B', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 1.6 },
		},
		c: {
			dataType: { kind: 'scalar' },
			ui: { label: 'C', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		d: {
			dataType: { kind: 'scalar' },
			ui: { label: 'D', control: { controlType: 'range', min: -3, max: 3, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.7 },
		},
		scale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Scale', control: { controlType: 'range', min: 0.01, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.2 },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		exposure: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Exposure', control: { controlType: 'range', min: 0, max: 20, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 3 },
		},
		gamma: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gamma', control: { controlType: 'range', min: 0.1, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Ramp', control: {} },
			defaultValue: {
				inputSource: 'literal',
				value: {
					interpolation: 'linear',
					colorSpace: 'srgb',
					stops: [
						{ id: 'empty', position: 0, color: [0, 0, 0, 0] },
						{ id: 'low', position: 0.2, color: [0.1, 0.25, 0.6, 0.6] },
						{ id: 'middle', position: 0.6, color: [0.15, 0.75, 1, 1] },
						{ id: 'high', position: 1, color: [1, 0.9, 0.65, 1] },
					],
				},
			},
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		orbitCount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Orbit Count', control: { controlType: 'range', min: 1, max: MAXIMUM_ORBIT_COUNT, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 1024 },
		},
		iterations: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Iterations', control: { controlType: 'range', min: 1, max: MAXIMUM_ITERATIONS, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 1024 },
		},
		burnIn: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Burn In', control: { controlType: 'range', min: 0, max: MAXIMUM_BURN_IN, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 128 },
		},
		densityResolution: {
			dataType: { kind: 'enum', options: ['256', '512', '1024', '2048'] },
			ui: { label: 'Density Resolution', control: { labels: { '256': '256', '512': '512', '1024': '1024', '2048': '2048' } } },
			defaultValue: { inputSource: 'literal', value: '1024' },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		density: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
