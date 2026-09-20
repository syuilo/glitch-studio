import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'gradient',
	displayName: 'Gradient',
	tags: [],
	paramDefs: {
		mode: {
			dataType: 'enum', ui: { control: 'enum' }, label: 'Type',
			options: [
				{ value: 'linear', label: 'Linear' },
				{ value: 'radial', label: 'Radial' },
			],
			default: () => ({ inputSource: 'literal', value: 'linear' }),
		},
		fitMode: { dataType: 'fitMode', ui: { control: 'fitMode' }, label: 'Fit mode', default: () => ({ inputSource: 'literal', value: 'cover' }) },
		center: { dataType: 'vector', ui: { control: 'vector', min: -1, max: 1, step: 0.01 }, label: 'Center', default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		startPosition: { dataType: 'number', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Start Position', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		endPosition: { dataType: 'number', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'End Position', canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		startValue: { dataType: 'number', ui: { control: 'number', step: 0.01 }, label: 'Start Value', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		endValue: { dataType: 'number', ui: { control: 'number', step: 0.01 }, label: 'End Value', canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		clampEdge: { dataType: 'bool', ui: { control: 'bool' }, label: 'Clamp to edge', default: () => ({ inputSource: 'literal', value: true }) },
		frequency: { dataType: 'number', ui: { control: 'number', step: 0.01 }, label: 'Frequency', canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		mirrorRepeat: { dataType: 'bool', ui: { control: 'bool' }, label: 'Mirror Repeat', default: () => ({ inputSource: 'literal', value: false }) },
		skew: { dataType: 'number', ui: { control: 'range', min: -1, max: 1, step: 0.01 }, label: 'Skew', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		phase: { dataType: 'number', ui: { control: 'range', min: -1, max: 1, step: 0.01 }, label: 'Phase', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) }, // TIPS: expressionでこれにTIMEを渡したいときは `TIME % 1` と書くことを推奨。そうしないと16bitの精度の問題で刻みが粗くなる。0~1の位相なので1で折り返して問題ない
		angle: { dataType: 'number', ui: { control: 'angle' }, label: 'Angle', default: () => ({ inputSource: 'literal', value: 0 }) },
		interpolation: {
			dataType: 'enum', ui: { control: 'enum' }, label: 'Interpolation',
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
			default: () => ({ inputSource: 'literal', value: 'linear' }),
		},
	},
	outputs: {
		scalar: { primary: true, dataType: 'scalar' },
		vector: { primary: false, dataType: 'vector', canLazyAllocation: true },
	},
});
