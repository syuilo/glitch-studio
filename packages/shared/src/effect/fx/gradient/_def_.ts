import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'gradient',
	displayName: 'Gradient',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		mode: { dataType: { kind: 'enum', options: ['linear', 'radial'] }, ui: { label: 'Type', control: { labels: { 'linear': 'Linear', 'radial': 'Radial' } } }, defaultValue: { inputSource: 'literal', value: 'linear' } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
		center: { dataType: { kind: 'vector' }, ui: { label: 'Center', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		startPosition: { dataType: { kind: 'scalar' }, ui: { label: 'Start Position', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		endPosition: { dataType: { kind: 'scalar' }, ui: { label: 'End Position', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		startValue: { dataType: { kind: 'scalar' }, ui: { label: 'Start Value', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		endValue: { dataType: { kind: 'scalar' }, ui: { label: 'End Value', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		clampEdge: { dataType: { kind: 'bool' }, ui: { label: 'Clamp to edge', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		frequency: { dataType: { kind: 'scalar' }, ui: { label: 'Frequency', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		mirrorRepeat: { dataType: { kind: 'bool' }, ui: { label: 'Mirror Repeat', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		skew: { dataType: { kind: 'scalar' }, ui: { label: 'Skew', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		// TIPS: expressionでこれにTIMEを渡したいときは `TIME % 1` と書くことを推奨。そうしないと16bitの精度の問題で刻みが粗くなる。0~1の位相なので1で折り返して問題ない
		phase: { dataType: { kind: 'scalar' }, ui: { label: 'Phase', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		interpolation: {
			dataType: { kind: 'enum', options: ['linear', 'smoothstep', 'smootherstep', 'cosine', 'circular', 'back', 'elastic', 'expo', 'expo-in', 'expo-out'] },
			ui: {
				label: 'Interpolation',
				control: {
					labels: {
						'linear': 'Linear',
						'smoothstep': 'Smoothstep',
						'smootherstep': 'Smootherstep',
						'cosine': 'Cosine',
						'circular': 'Circular',
						'back': 'Back',
						'elastic': 'Elastic',
						'expo': 'Expo',
						'expo-in': 'Expo In',
						'expo-out': 'Expo Out',
					},
				},
			},
			defaultValue: { inputSource: 'literal', value: 'linear' },
		},
	},
	outputDefs: {
		scalar: { primary: true, dataType: { kind: 'scalar' } },
		vector: { primary: false, dataType: { kind: 'vector' }, canLazyAllocation: true },
	},
});
