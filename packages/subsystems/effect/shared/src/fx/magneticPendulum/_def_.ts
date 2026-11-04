import { defineEffect } from '../../effect-definition.ts';

export const MAXIMUM_MAGNET_COUNT = 8;

export default defineEffect({
	id: 'magneticPendulum',
	displayName: 'Magnetic Pendulum',
	description: {
		'ja-JP': '各位置から放した磁気振り子の収束先を色分けし、フラクタル模様を生成します。位置・高さは長辺全体=1の共通単位です。計算上限までに収束しない点はUnconverged Colorで描画します。',
		'en-US': 'Generates fractal basins by coloring each release position by the magnet that captures the pendulum. Positions and height use one full render long side. Points that do not settle within the step limit use Unconverged Color.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		magnets: {
			dataType: {
				kind: 'array',
				elementType: { kind: 'struct', fields: { position: { kind: 'vector' }, strength: { kind: 'scalar' }, color: { kind: 'color' } } },
			},
			ui: {
				label: 'Magnets',
				control: {
					element: {
						fields: {
							position: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
							strength: { label: 'Strength', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } },
							color: { label: 'Color', control: {} },
						},
					},
				},
			},
			maxElements: MAXIMUM_MAGNET_COUNT,
			defaultValue: {
				inputSource: 'literal',
				value: [
					{
						id: 'first',
						binding: {
							inputSource: 'literal',
							value: {
								position: { inputSource: 'literal', value: [0, 0.25] },
								strength: { inputSource: 'literal', value: 1 },
								color: { inputSource: 'literal', value: [1, 0, 0, 1] },
							},
						},
					},
					{
						id: 'second',
						binding: {
							inputSource: 'literal',
							value: {
								position: { inputSource: 'literal', value: [-Math.sqrt(3) / 8, -0.125] },
								strength: { inputSource: 'literal', value: 1 },
								color: { inputSource: 'literal', value: [0, 1, 0, 1] },
							},
						},
					},
					{
						id: 'third',
						binding: {
							inputSource: 'literal',
							value: {
								position: { inputSource: 'literal', value: [Math.sqrt(3) / 8, -0.125] },
								strength: { inputSource: 'literal', value: 1 },
								color: { inputSource: 'literal', value: [0, 0, 1, 1] },
							},
						},
					},
				],
			},
			element: {
				defaultValue: {
					inputSource: 'literal',
					value: {
						position: { inputSource: 'literal', value: [0, 0] },
						strength: { inputSource: 'literal', value: 1 },
						color: { inputSource: 'literal', value: [1, 1, 1, 1] },
					},
				},
				fields: {
					position: { defaultValue: { inputSource: 'literal', value: [0, 0] } },
					strength: { defaultValue: { inputSource: 'literal', value: 1 } },
					color: { canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
				},
			},
		},
		damping: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Damping', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.14 },
		},
		restoringStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Restoring Strength', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		magnetHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Magnet Height', control: { controlType: 'range', min: 0.005, max: 0.25, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.08 },
		},
		initialVelocity: {
			dataType: { kind: 'vector' },
			ui: { label: 'Initial Velocity', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		viewCenter: {
			dataType: { kind: 'vector' },
			ui: { label: 'View Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Zoom', control: { controlType: 'range', min: 0.1, max: 100, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		settlingShading: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Settling Shading', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		unconvergedColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Unconverged Color', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] },
		},
		timeStep: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Time Step', control: { controlType: 'range', min: 0.001, max: 0.1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.06 },
		},
		maximumSteps: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Steps', control: { controlType: 'range', min: 1, max: 2048, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 1024 },
		},
		captureRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Capture Radius', control: { controlType: 'range', min: 0.001, max: 0.1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		captureSpeed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Capture Speed', control: { controlType: 'range', min: 0, max: 0.25, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.045 },
		},
		antialiasing: {
			dataType: { kind: 'bool' },
			ui: { label: 'Antialiasing', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
