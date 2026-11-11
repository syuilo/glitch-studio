import { defineEffect } from '../../effect-definition.ts';

export const MAXIMUM_MAGNET_COUNT = 8;
export const MAGNETIC_PENDULUM_MINIMUM_ZOOM = 0.001;

export default defineEffect({
	id: 'magneticPendulum',
	displayName: 'Magnetic Pendulum',
	description: {
		'ja-JP': '磁気振り子の収束先を色分けし、フラクタル模様を生成します。',
		'en-US': 'Generates fractal patterns by coloring where magnetic pendulums settle.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'fractal', 'simulation', 'math', 'gimmicky', 'experimental'],
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
		view: {
			dataType: { kind: 'struct', fields: { center: { kind: 'vector' }, zoom: { kind: 'scalar' } } },
			ui: { label: 'View', control: {
				// centerは内部シミュレーション単位ではなく、長辺全体=1の公開座標。
				controlType: 'viewport2d', spanAtZoomOne: 1, minimumZoom: MAGNETIC_PENDULUM_MINIMUM_ZOOM,
				fields: {
					center: { label: 'Center', control: { controlType: 'vector', min: -0.5, max: 0.5, step: 0.01 } },
					zoom: { label: 'Zoom', control: { controlType: 'range', min: 0.1, max: 100, logarithmic: true } },
				},
			} },
			fields: {
				center: { defaultValue: { inputSource: 'literal', value: [0, 0] } },
				zoom: { defaultValue: { inputSource: 'literal', value: 1 } },
			},
			defaultValue: { inputSource: 'literal', value: {
				center: { inputSource: 'literal', value: [0, 0] },
				zoom: { inputSource: 'literal', value: 1 },
			} },
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
