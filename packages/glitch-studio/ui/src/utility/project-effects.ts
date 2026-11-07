import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { getProjectEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';

export function getEffectDefinitions(state: { customShaderEffects?: { readonly value: readonly ProjectCustomShaderEffect[] } }) {
	return getProjectEffectDefinitions(state.customShaderEffects?.value ?? [], effectDefinitions);
}
