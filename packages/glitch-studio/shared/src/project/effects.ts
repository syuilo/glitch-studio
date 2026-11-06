import { createCustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { ProjectCustomShaderEffect } from './types.ts';

/** プロジェクトの定義は呼び出し側の一覧へ合成し、組み込みのグローバル登録を変更しない。 */
export function getProjectEffectDefinitions(customShaderEffects: readonly ProjectCustomShaderEffect[], builtinDefinitions: Readonly<Record<string, EffectDefinition>>): Record<string, EffectDefinition> {
	return Object.fromEntries([
		...Object.entries(builtinDefinitions),
		...customShaderEffects.map(customShaderEffect => {
			const definition = createCustomShaderEffectDefinition(customShaderEffect, customShaderEffect);
			return [definition.id, definition] as const;
		}),
	]);
}
