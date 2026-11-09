import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'mandelbrot',
	displayName: 'Mandelbrot',
	description: {
		'ja-JP': 'マンデルブロ集合のフラクタル模様を生成します。',
		'en-US': 'Generates fractal patterns of the Mandelbrot set.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'fractal', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		complexCenter: {
			dataType: { kind: 'vector' },
			ui: { label: 'Complex Center', control: { controlType: 'vector', min: -2, max: 2, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: [-0.5, 0] },
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Zoom', control: { controlType: 'range', min: 0.1, max: 1000, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		coordinateOffset: {
			dataType: { kind: 'vector' },
			ui: { label: 'Coordinate Offset', control: { controlType: 'vector', min: -0.5, max: 0.5, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		maximumIterations: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Iterations', control: { controlType: 'range', min: 1, max: 2048, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 512 },
		},
		coloringMethod: {
			dataType: { kind: 'enum', options: ['escapeIterations', 'smoothEscapeIterations', 'triangleInequalityAverage'] },
			ui: {
				label: 'Coloring Method',
				control: {
					labels: {
						escapeIterations: 'Escape Iterations',
						smoothEscapeIterations: 'Smooth Escape Iterations',
						triangleInequalityAverage: 'Triangle Inequality Average',
					},
				},
			},
			defaultValue: { inputSource: 'literal', value: 'smoothEscapeIterations' },
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Color Ramp', control: {} },
			defaultValue: { inputSource: 'literal', value: {
				interpolation: 'linear', colorSpace: 'srgb', stops: [
					{ id: 'start', position: 0, color: srgbToLinearSrgb([0.025, 0.04, 0.14, 1]) },
					{ id: 'blue', position: 0.25, color: srgbToLinearSrgb([0.05, 0.3, 0.85, 1]) },
					{ id: 'light', position: 0.5, color: srgbToLinearSrgb([1, 0.95, 0.65, 1]) },
					{ id: 'orange', position: 0.75, color: srgbToLinearSrgb([1, 0.3, 0.04, 1]) },
					{ id: 'end', position: 1, color: srgbToLinearSrgb([0.025, 0.04, 0.14, 1]) },
				],
			} },
		},
		iterationColorPeriod: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Iteration Color Period', control: { controlType: 'range', min: 1, max: 256, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 32 },
		},
		triangleColorDensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'TIA Color Density', control: { controlType: 'range', min: 0.1, max: 100, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 10 },
		},
		colorPhase: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Phase', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		unescapedColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Unescaped Color', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] },
		},
		bailoutRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Bailout Radius', control: { controlType: 'range', min: 2, max: 1e12, logarithmic: true } },
			// 参考実装の「二乗ノルムの閾値1e20」に相当する半径。
			// 全彩色モードで同じ値を使い、反復回数・未発散判定の意味を切り替えない。
			defaultValue: { inputSource: 'literal', value: 1e10 },
		},
		antialiasing: {
			dataType: { kind: 'bool' },
			ui: { label: 'Antialiasing', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		escapeIterations: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
		smoothIterations: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
		escapedMask: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
		triangleInequalityAverage: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
