import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'gradient',
	displayName: 'Gradient',
	tags: [],
	paramDefs: {
		mode: {
			dataType: 'enum', ui: { label: 'Type', control: 'enum' },
			options: [
				{ value: 'linear', label: 'Linear' },
				{ value: 'radial', label: 'Radial' },
			],
			defaultValue: { inputSource: 'literal', value: 'linear' },
		},
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'cover' } },
		center: { dataType: 'vector', ui: { label: 'Center', control: 'vector', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		startPosition: { dataType: 'scalar', ui: { label: 'Start Position', control: 'range', min: 0, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		endPosition: { dataType: 'scalar', ui: { label: 'End Position', control: 'range', min: 0, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		startValue: { dataType: 'scalar', ui: { label: 'Start Value', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		endValue: { dataType: 'scalar', ui: { label: 'End Value', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		clampEdge: { dataType: 'bool', ui: { label: 'Clamp to edge', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
		frequency: { dataType: 'scalar', ui: { label: 'Frequency', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		mirrorRepeat: { dataType: 'bool', ui: { label: 'Mirror Repeat', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
		skew: { dataType: 'scalar', ui: { label: 'Skew', control: 'range', min: -1, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		// TIPS: expressionでこれにTIMEを渡したいときは `TIME % 1` と書くことを推奨。そうしないと16bitの精度の問題で刻みが粗くなる。0~1の位相なので1で折り返して問題ない
		phase: { dataType: 'scalar', ui: { label: 'Phase', control: 'range', min: -1, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		angle: { dataType: 'scalar', ui: { label: 'Angle', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
		interpolation: {
			dataType: 'enum', ui: { label: 'Interpolation', control: 'enum' },
			options: [
				{ value: 'linear', label: 'Linear' },
				{ value: 'smoothstep', label: 'Smoothstep' },
				{ value: 'smootherstep', label: 'Smootherstep' },
				{ value: 'cosine', label: 'Cosine' },
				{ value: 'circular', label: 'Circular' },
				{ value: 'back', label: 'Back' },
				{ value: 'elastic', label: 'Elastic' },
				{ value: 'expo', label: 'Expo' },
				{ value: 'expo-in', label: 'Expo In' },
				{ value: 'expo-out', label: 'Expo Out' },
			],
			defaultValue: { inputSource: 'literal', value: 'linear' },
		},
	},
	outputs: {
		scalar: { primary: true, dataType: 'scalar' },
		vector: { primary: false, dataType: 'vector', canLazyAllocation: true },
	},
});
