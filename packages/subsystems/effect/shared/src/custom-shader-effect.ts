import type { CustomShaderEffectDefinition } from './custom-shader-effect-definition.ts';
import type { EffectDefinition } from './effect-definition.ts';

const CUSTOM_SHADER_EFFECT_PREFIX = 'customShaderEffect:';

/** 組み込みEffectと同じ参照経路を使い、登録IDの名前空間だけを分ける。 */
export function customShaderEffectReference(id: string): string {
	return CUSTOM_SHADER_EFFECT_PREFIX + id;
}

export function isCustomShaderEffectReference(id: string): boolean {
	return id.startsWith(CUSTOM_SHADER_EFFECT_PREFIX);
}

/** 保存Binding・配線は固定ID、WGSLとの対応は実装側が所有する。 */
export function createCustomShaderEffectDefinition(definition: CustomShaderEffectDefinition, identity: { id: string; name: string; description: string }): EffectDefinition {
	return {
		id: customShaderEffectReference(identity.id),
		displayName: identity.name,
		description: { 'ja-JP': identity.description, 'en-US': identity.description },
		kind: definition.kind,
		dependsOnRenderHistory: false,
		tags: [],
		paramDefs: Object.fromEntries(definition.paramDefs.map(parameter => [parameter.id, parameter])),
		outputDefs: Object.fromEntries(definition.outputDefs.map(output => [output.id, { dataType: output.dataType, label: output.label }])),
		primaryInputParameter: definition.primaryInputId,
		primaryOutput: definition.primaryOutputId,
		resolutionInputParameters: definition.resolutionInputIds,
	};
}
