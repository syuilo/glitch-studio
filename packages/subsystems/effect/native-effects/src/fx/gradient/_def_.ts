import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { gradientInterpolationParameter } from '../../gradient-interpolation.ts';

export default defineNativeEffect({
	displayName: 'Gradient',
	summary: {
		'ja-JP': '直線状または放射状に変化するスカラー場と、その勾配のベクトル場を生成します。',
		'en-US': 'Generates a linear or radial scalar field and a vector field of its gradient.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['gradient', 'utility'],
	paramDefs: {
		mode: { dataType: { kind: 'enum', options: ['linear', 'radial'] }, ui: { label: 'Type', control: { labels: { 'linear': 'Linear', 'radial': 'Radial' } } }, defaultValue: 'linear' },
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		center: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Center',
				control: {
					controlType: 'vector',
					min: -0.5,
					max: 0.5,
					step: 0.01,
				},
			},
			defaultValue: [0, 0],
		},
		startPosition: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Start Position',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: 0,
		},
		endPosition: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'End Position',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: 1,
		},
		startValue: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Start Value', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 0,
		},
		endValue: {
			dataType: { kind: 'scalar' },
			ui: { label: 'End Value', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 1,
		},
		clampEdge: { dataType: { kind: 'bool' }, ui: { label: 'Clamp to Edge', control: {} }, defaultValue: true },
		frequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Frequency', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 1,
		},
		mirrorRepeat: { dataType: { kind: 'bool' }, ui: { label: 'Mirror Repeat', control: {} }, defaultValue: false },
		skew: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Skew',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: 0,
		},
		// TIPS: expressionでこれにTIMEを渡したいときは `TIME % 1` と書くことを推奨。そうしないと16bitの精度の問題で刻みが粗くなる。0~1の位相なので1で折り返して問題ない
		phase: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Phase',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: 0,
		},
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, defaultValue: 0 },
		interpolation: { ...gradientInterpolationParameter, defaultValue: 'linear' },
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		scalar: { dataType: { kind: 'scalar' } },
		vector: { dataType: { kind: 'vector' } },
	},
	primaryOutput: 'scalar',
});
