// 演算名・表示名・WGSLのswitchに対応する番号を、このエフェクト内で管理する。
export const vectorMathOperations = {
	add: { shaderOperationId: 0, label: 'Add' },
	subtract: { shaderOperationId: 1, label: 'Subtract' },
	multiply: { shaderOperationId: 2, label: 'Multiply (Components)' },
	divide: { shaderOperationId: 3, label: 'Divide (Components)' },
	scale: { shaderOperationId: 4, label: 'Scale' },
	scaleAdd: { shaderOperationId: 5, label: 'Scale and Add' },
	rotate: { shaderOperationId: 6, label: 'Rotate' },
	minimum: { shaderOperationId: 7, label: 'Minimum' },
	maximum: { shaderOperationId: 8, label: 'Maximum' },
	absolute: { shaderOperationId: 9, label: 'Absolute' },
	floor: { shaderOperationId: 10, label: 'Floor' },
	fract: { shaderOperationId: 11, label: 'Fract' },
	sine: { shaderOperationId: 12, label: 'Sine (Turns)' },
	cosine: { shaderOperationId: 13, label: 'Cosine (Turns)' },
} as const;

export type VectorMathOperation = keyof typeof vectorMathOperations;

export const vectorMathOperationIds = Object.keys(vectorMathOperations) as readonly VectorMathOperation[];

export const vectorMathOperationLabels = Object.fromEntries(
	Object.entries(vectorMathOperations).map(([operation, settings]) => [operation, settings.label]),
) as Record<VectorMathOperation, string>;
