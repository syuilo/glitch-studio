// WGSLのswitchと対応する番号、必要な入力数、表示名をエフェクト内の一か所で管理する。
export const scalarMathOperations = {
	add: { shaderOperationId: 0, inputCount: 2, label: 'Add' },
	subtract: { shaderOperationId: 1, inputCount: 2, label: 'Subtract' },
	multiply: { shaderOperationId: 2, inputCount: 2, label: 'Multiply' },
	divide: { shaderOperationId: 3, inputCount: 2, label: 'Divide' },
	minimum: { shaderOperationId: 4, inputCount: 2, label: 'Minimum' },
	maximum: { shaderOperationId: 5, inputCount: 2, label: 'Maximum' },
	absolute: { shaderOperationId: 6, inputCount: 1, label: 'Absolute' },
	sign: { shaderOperationId: 7, inputCount: 1, label: 'Sign' },
	floor: { shaderOperationId: 8, inputCount: 1, label: 'Floor' },
	ceil: { shaderOperationId: 9, inputCount: 1, label: 'Ceil' },
	round: { shaderOperationId: 10, inputCount: 1, label: 'Round' },
	fract: { shaderOperationId: 11, inputCount: 1, label: 'Fract' },
	modulo: { shaderOperationId: 12, inputCount: 2, label: 'Modulo' },
	power: { shaderOperationId: 13, inputCount: 2, label: 'Power' },
	squareRoot: { shaderOperationId: 14, inputCount: 1, label: 'Square Root' },
	sine: { shaderOperationId: 15, inputCount: 1, label: 'Sine (Turns)' },
	cosine: { shaderOperationId: 16, inputCount: 1, label: 'Cosine (Turns)' },
	tangent: { shaderOperationId: 17, inputCount: 1, label: 'Tangent (Turns)' },
	step: { shaderOperationId: 18, inputCount: 2, label: 'Step (A ≥ B)' },
	smoothstep: { shaderOperationId: 19, inputCount: 3, label: 'Smoothstep (B → C)' },
	greaterThan: { shaderOperationId: 20, inputCount: 2, label: 'Greater Than' },
	lessThan: { shaderOperationId: 21, inputCount: 2, label: 'Less Than' },
	equal: { shaderOperationId: 22, inputCount: 2, label: 'Equal' },
	clamp: { shaderOperationId: 23, inputCount: 3, label: 'Clamp (B, C)' },
} as const;

export type ScalarMathOperation = keyof typeof scalarMathOperations;

export const scalarMathOperationIds = Object.keys(scalarMathOperations) as readonly ScalarMathOperation[];

export const scalarMathOperationLabels = Object.fromEntries(
	Object.entries(scalarMathOperations).map(([operation, settings]) => [operation, settings.label]),
) as Record<ScalarMathOperation, string>;
