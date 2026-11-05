import { defineEffect } from '../../effect-definition.ts';

export const MAXIMUM_MAGNET_COUNT = 8;

export default defineEffect({
	id: 'magneticPendulum',
	displayName: 'Magnetic Pendulum',
	description: {
		'ja-JP': '各位置から放した磁気振り子の収束先を色分けし、フラクタル模様を生成します。Basin Valueは磁石のValue、Settling Timeは正規化前の収束時間、Travel Distanceは追跡した折れ線の長さです。位置・高さ・距離は長辺全体=1の共通単位です。未収束点の時間・距離は0で、Converged Maskで区別できます。',
		'en-US': 'Generates fractal basins and outputs each magnet\'s Value, raw simulation settling time, piecewise-linear travel distance, and a convergence mask. Positions, heights, and distances use one full render long side. Unconverged points output zero time and distance; use Converged Mask to distinguish them.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		magnets: {
			dataType: {
				kind: 'array',
				elementType: { kind: 'struct', fields: { position: { kind: 'vector' }, height: { kind: 'scalar' }, strength: { kind: 'scalar' }, color: { kind: 'color' }, value: { kind: 'scalar' } } },
			},
			ui: {
				label: 'Magnets',
				control: {
					element: {
						fields: {
							position: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
							height: { label: 'Height', control: { controlType: 'range', min: 0.005, max: 0.25, step: 0.001 } },
							strength: { label: 'Strength', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } },
							color: { label: 'Color', control: {} },
							value: { label: 'Value', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
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
								height: { inputSource: 'literal', value: 0.08 },
								strength: { inputSource: 'literal', value: 1 },
								color: { inputSource: 'literal', value: [1, 0, 0, 1] },
								value: { inputSource: 'literal', value: 0.1 },
							},
						},
					},
					{
						id: 'second',
						binding: {
							inputSource: 'literal',
							value: {
								position: { inputSource: 'literal', value: [-Math.sqrt(3) / 8, -0.125] },
								height: { inputSource: 'literal', value: 0.08 },
								strength: { inputSource: 'literal', value: 1 },
								color: { inputSource: 'literal', value: [0, 1, 0, 1] },
								value: { inputSource: 'literal', value: 0.2 },
							},
						},
					},
					{
						id: 'third',
						binding: {
							inputSource: 'literal',
							value: {
								position: { inputSource: 'literal', value: [Math.sqrt(3) / 8, -0.125] },
								height: { inputSource: 'literal', value: 0.08 },
								strength: { inputSource: 'literal', value: 1 },
								color: { inputSource: 'literal', value: [0, 0, 1, 1] },
								value: { inputSource: 'literal', value: 0.3 },
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
						height: { inputSource: 'literal', value: 0.08 },
						strength: { inputSource: 'literal', value: 1 },
						color: { inputSource: 'literal', value: [1, 1, 1, 1] },
						value: { inputSource: 'literal', value: 1 },
					},
				},
				fields: {
					position: { defaultValue: { inputSource: 'literal', value: [0, 0] } },
					height: { defaultValue: { inputSource: 'literal', value: 0.08 } },
					strength: { defaultValue: { inputSource: 'literal', value: 1 } },
					color: { canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
					value: { defaultValue: { inputSource: 'literal', value: 1 } },
				},
			},
		},
		damping: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Damping', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.14 },
		},
		restoringStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Restoring Strength', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
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
		unconvergedValue: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Unconverged Value', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
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
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		basinValue: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
		settlingTime: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
		convergedMask: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
		travelDistance: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
