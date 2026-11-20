// WGSLのswitchと対応する番号と表示名をエフェクト内の一か所で管理する。
export const scalarMathOperations = {
	add: { shaderOperationId: 0, label: 'Add' },
	subtract: { shaderOperationId: 1, label: 'Subtract' },
	multiply: { shaderOperationId: 2, label: 'Multiply' },
	divide: { shaderOperationId: 3, label: 'Divide' },
	minimum: { shaderOperationId: 4, label: 'Minimum' },
	maximum: { shaderOperationId: 5, label: 'Maximum' },
	absolute: { shaderOperationId: 6, label: 'Absolute' },
	sign: { shaderOperationId: 7, label: 'Sign' },
	floor: { shaderOperationId: 8, label: 'Floor' },
	ceil: { shaderOperationId: 9, label: 'Ceil' },
	round: { shaderOperationId: 10, label: 'Round' },
	fract: { shaderOperationId: 11, label: 'Fract' },
	modulo: { shaderOperationId: 12, label: 'Modulo' },
	power: { shaderOperationId: 13, label: 'Power' },
	squareRoot: { shaderOperationId: 14, label: 'Square Root' },
	sine: { shaderOperationId: 15, label: 'Sine (Turns)' },
	cosine: { shaderOperationId: 16, label: 'Cosine (Turns)' },
	tangent: { shaderOperationId: 17, label: 'Tangent (Turns)' },
	step: { shaderOperationId: 18, label: 'Step (A ≥ B)' },
	smoothstep: { shaderOperationId: 19, label: 'Smoothstep (B → C)' },
	greaterThan: { shaderOperationId: 20, label: 'Greater Than' },
	lessThan: { shaderOperationId: 21, label: 'Less Than' },
	equal: { shaderOperationId: 22, label: 'Equal' },
	clamp: { shaderOperationId: 23, label: 'Clamp (B, C)' },
} as const;

export type ScalarMathOperation = keyof typeof scalarMathOperations;

export const scalarMathOperationIds = Object.keys(scalarMathOperations) as readonly ScalarMathOperation[];

export const scalarMathOperationLabels = Object.fromEntries(
	Object.entries(scalarMathOperations).map(([operation, settings]) => [operation, settings.label]),
) as Record<ScalarMathOperation, string>;
