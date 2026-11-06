import { getProjectEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { customShaderEffectReference } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import { createCustomShaderEffectImplementation } from '@gs/subsystems_effect_renderer/custom-shader-effect.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectImplementation } from '@gs/subsystems_effect_shared/effect-implementation.ts';

export function createProjectEffects(customShaderEffects: readonly ProjectCustomShaderEffect[], definitions: Record<string, EffectDefinition>, implementations: Record<string, EffectImplementation>) {
	return {
		definitions: getProjectEffectDefinitions(customShaderEffects, definitions),
		implementations: { ...implementations, ...Object.fromEntries(customShaderEffects.map(definition => [customShaderEffectReference(definition.id), createCustomShaderEffectImplementation(definition)])) },
	};
}
