import { nativeEffectDefinitions } from '@gs/subsystems_effect-new_native-effects/definitions.ts';
import { createProjectEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectDefinition, NativeEffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { ProjectEffectRegistrations } from '@gs/glitch-studio_shared/project/types.ts';

type RegistrationState = { [K in keyof ProjectEffectRegistrations]?: { readonly value: ProjectEffectRegistrations[K] } };
export type EffectChoice = EffectDefinition & Pick<NativeEffectDefinition, 'displayName' | 'summary' | 'tags'> & { effectSource: EffectSource };
const natives: Readonly<Record<string, NativeEffectDefinition>> = nativeEffectDefinitions;

export function getEffectDefinitions(state: RegistrationState) {
	const customShaderEffects = state.customShaderEffects?.value ?? [];
	const customNodeGraphEffects = state.customNodeGraphEffects?.value ?? [];
	const definitions = createProjectEffectDefinitions({ customShaderEffects, customNodeGraphEffects }, natives);

	function describe(effectSource: EffectSource): EffectChoice {
		if (effectSource.type === 'nativeEffect') {
			if (!Object.hasOwn(natives, effectSource.id)) throw new Error('Unknown Native Effect: ' + effectSource.id);
			return { ...natives[effectSource.id], effectSource };
		}
		const { definition } = resolveEffectSource(effectSource, definitions);
		const registration = effectSource.type === 'customShaderEffectReference' ? customShaderEffects.find(entry => entry.id === effectSource.id)
			: effectSource.type === 'customNodeGraphEffectReference' ? customNodeGraphEffects.find(entry => entry.id === effectSource.id) : null;
		const summary = registration != null && 'summary' in registration ? registration.summary : '';
		const displayName = registration?.name ?? (effectSource.type === 'inlineCustomShaderEffect' ? 'Custom Shader Effect' : 'Custom Node Graph Effect');
		return { ...definition, effectSource, displayName, tags: [], summary: { 'ja-JP': summary, 'en-US': summary } };
	}

	return { ...definitions, describe };
}

export function listSelectableEffects(state: RegistrationState) {
	const definitions = getEffectDefinitions(state);
	return [
		...Object.keys(natives).map(id => definitions.describe({ type: 'nativeEffect', id })),
		...(state.customShaderEffects?.value ?? []).map(entry => definitions.describe({ type: 'customShaderEffectReference', id: entry.id })),
	];
}
