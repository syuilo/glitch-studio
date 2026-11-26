// カタログでは未定義のまま保持し、作品ごとの最終バンドルで置換する。
export const portableParameterDefines = {
	curveAnimation: 'USE_CURVE_ANIMATION',
	keyframes: 'USE_KEYFRAMES',
	bezier: 'USE_BEZIER_FUNCTION_CURVE',
	fixedFunctionCurve: 'USE_FIXED_FUNCTION_CURVE',
	easing: 'USE_EASING',
	functionCurveExpression: 'USE_FUNCTION_CURVE_EXPRESSION',
	random: 'USE_RANDOM_EXPRESSION',
	noise: 'USE_NOISE_EXPRESSION',
} as const;

export type PortableNodesEffectParameterFeature = keyof typeof portableParameterDefines;
