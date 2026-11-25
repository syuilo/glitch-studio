// 宣言順はgradient-interpolation.wgslに渡す補間の番号と対応する。
const labels = {
	linear: 'Linear',
	smoothstep: 'Smoothstep',
	smootherstep: 'Smootherstep',
	cosine: 'Cosine',
	circular: 'Circular',
	back: 'Back',
	elastic: 'Elastic',
	expo: 'Expo',
	'expo-in': 'Expo In',
	'expo-out': 'Expo Out',
} as const;

export const gradientInterpolationParameter = {
	dataType: { kind: 'enum', options: Object.keys(labels) as (keyof typeof labels)[] },
	ui: { label: 'Interpolation', control: { labels } },
} as const;
