import type { EffectDefinitions } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { ProjectEffectRegistrations } from './types.ts';

export type NativeEffectDefinitions = Readonly<Record<string, ReturnType<EffectDefinitions['getNativeEffect']>>>;

function indexDefinitions<T>(entries: readonly { id: string; definition: T }[], kind: string): (id: string) => T {
	const definitions = new Map(entries.map(entry => [entry.id, entry.definition]));
	if (definitions.size !== entries.length) throw new Error('Duplicate ' + kind + ' ID');
	return id => {
		const definition = definitions.get(id);
		if (definition == null) throw new Error('Unknown ' + kind + ': ' + id);
		return definition;
	};
}

/** 一つのスナップショットから索引を作る。同じ文字列IDでもEffectの種類ごとに独立して解決する。 */
export function createProjectEffectDefinitions(project: ProjectEffectRegistrations, nativeDefinitions: NativeEffectDefinitions): EffectDefinitions {
	return {
		getNativeEffect(id) {
			if (!Object.hasOwn(nativeDefinitions, id)) throw new Error('Unknown Native Effect: ' + id);
			return nativeDefinitions[id];
		},
		getCustomShaderEffect: indexDefinitions(project.customShaderEffects, 'Custom Shader Effect'),
		getCustomNodeGraphEffect: indexDefinitions(project.customNodeGraphEffects, 'Custom Node Graph Effect'),
	};
}
