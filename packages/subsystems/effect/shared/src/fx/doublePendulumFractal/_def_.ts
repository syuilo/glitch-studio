import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineEffect } from '../../effect-definition.ts';

export const DOUBLE_PENDULUM_FRACTAL_SPAN_AT_ZOOM_ONE = 2 * Math.PI;

export default defineEffect({
	id: 'doublePendulumFractal',
	displayName: 'Double Pendulum Fractal',
	description: {
		'ja-JP': '初期角度の異なる二重振り子を指定時間まで計算し、角度や角速度から模様を生成します。',
		'en-US': 'Generates patterns from the angles and angular velocities of double pendulums with different initial angles.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	canHaveLongRunningRenderPass: true,
	tags: ['pattern', 'fractal', 'simulation', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		simulationTime: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Simulation Time', control: { controlType: 'number', min: 0, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 3 },
		},
		view: {
			dataType: { kind: 'struct', fields: { center: { kind: 'vector' }, zoom: { kind: 'scalar' } } },
			ui: { label: 'View', control: {
				controlType: 'viewport2d', spanAtZoomOne: DOUBLE_PENDULUM_FRACTAL_SPAN_AT_ZOOM_ONE,
				fields: {
					// 中心は[theta1, -theta2]。表示の+Yを上に揃え、描画側で物理角度へ戻す。
					// 単位はradなので、turn単位のAngleコントロールは使用しない。
					center: { label: 'Angle Center (rad)', control: { controlType: 'vector', min: -Math.PI, max: Math.PI, step: 0.001 } },
					zoom: { label: 'Zoom', control: { controlType: 'range', min: 0.1, max: 1000, logarithmic: true } },
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
		initialAngularVelocity1: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Initial Angular Velocity 1 (rad/s)', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		initialAngularVelocity2: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Initial Angular Velocity 2 (rad/s)', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		lengthRatio: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Length Ratio', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		massRatio: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Mass Ratio', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		gravity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gravity', control: { controlType: 'range', min: 0, max: 30, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 9.81 },
		},
		coloringMethod: {
			dataType: { kind: 'enum', options: ['sphericalRgb', 'angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'] },
			ui: { label: 'Coloring', control: { labels: {
				sphericalRgb: 'Spherical RGB', angle1: 'Angle 1', angle2: 'Angle 2',
				angularVelocity1: 'Angular Velocity 1', angularVelocity2: 'Angular Velocity 2',
			} } },
			defaultValue: { inputSource: 'literal', value: 'sphericalRgb' },
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Color Ramp', control: {} },
			defaultValue: { inputSource: 'literal', value: {
				interpolation: 'linear', colorSpace: 'srgb', stops: [
					{ id: 'start', position: 0, color: srgbToLinearSrgb([0.05, 0.15, 0.6, 1]) },
					{ id: 'middle', position: 0.5, color: srgbToLinearSrgb([0.1, 0.9, 0.8, 1]) },
					{ id: 'end', position: 1, color: srgbToLinearSrgb([0.9, 0.1, 0.6, 1]) },
				],
			} },
		},
		angularVelocityRange: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angular Velocity Range (rad/s)', control: { controlType: 'range', min: 0.1, max: 100, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 10 },
		},
		timeStep: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Time Step', control: { controlType: 'range', min: 0.0005, max: 0.05, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 0.01 },
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
		angle1: { dataType: { kind: 'scalar' }, label: 'Angle 1 (rad)', canLazyAllocation: true },
		angle2: { dataType: { kind: 'scalar' }, label: 'Angle 2 (rad)', canLazyAllocation: true },
		angularVelocity1: { dataType: { kind: 'scalar' }, label: 'Angular Velocity 1 (rad/s)', canLazyAllocation: true },
		angularVelocity2: { dataType: { kind: 'scalar' }, label: 'Angular Velocity 2 (rad/s)', canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
