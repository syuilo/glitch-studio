import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** PUBLICはCPU値を読む。コンテナを公開できるのは、すべての末端がCPU値である場合。 */
export function canReadPublicParameterInExpression(definition: ParameterDefinition): boolean {
	if (definition.dataType.kind === 'array') return canReadPublicParameterInExpression(getArrayElementDefinition(definition));
	if (definition.dataType.kind === 'struct') return Object.values(getStructFieldDefinitions(definition)).every(canReadPublicParameterInExpression);
	return definition.canNode !== true && definition.dataType.kind !== 'audioSource';
}
