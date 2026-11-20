import { nativeEffectDefinitions } from '@gs/subsystems_effect-new_native-effects/definitions.ts';
import { createProjectEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import type { EffectDefinition, NativeEffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { ProjectCustomNodeGraphEffect, ProjectEffectRegistrations } from '@gs/glitch-studio_shared/project/types.ts';

type RegistrationState = { [K in keyof ProjectEffectRegistrations]?: { readonly value: ProjectEffectRegistrations[K] } };
export type EffectChoice = EffectDefinition & Pick<NativeEffectDefinition, 'displayName' | 'summary' | 'tags'> & { effectSource: EffectSource };
const natives: Readonly<Record<string, NativeEffectDefinition>> = nativeEffectDefinitions;

function describeCustomEffect(effectSource: EffectSource, definition: EffectDefinition, displayName: string, summary = ''): EffectChoice {
	return { ...definition, effectSource, displayName, tags: [], summary: { 'ja-JP': summary, 'en-US': summary } };
}

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
		return describeCustomEffect(effectSource, definition, displayName, summary);
	}

	return { ...definitions, describe };
}

export function listSelectableEffects(state: RegistrationState): EffectChoice[] {
	return [
		...Object.entries(natives).map(([id, definition]) => ({ ...definition, effectSource: { type: 'nativeEffect' as const, id } })),
		...(state.customShaderEffects?.value ?? []).map(entry => describeCustomEffect({ type: 'customShaderEffectReference', id: entry.id }, entry.definition, entry.name, entry.summary)),
		...(state.customNodeGraphEffects?.value ?? []).map(entry => describeCustomEffect({ type: 'customNodeGraphEffectReference', id: entry.id }, entry.definition, entry.name)),
	];
}

/** 同じ配置先の候補をまとめて調べる間だけ、登録済みグラフの探索結果を共有する。 */
export function createEffectNodeCycleCheck(registrations: readonly ProjectCustomNodeGraphEffect[], parentCustomNodeGraphEffectId: string) {
	const graphs = new Map(registrations.map(entry => [entry.id, entry.definition]));
	const cyclic = new Map<string, boolean>([[parentCustomNodeGraphEffectId, true]]);

	function hasCyclicNode(graph: CustomNodeGraphEffect): boolean {
		return graph.nodes.some(node => node.type !== 'relay' && wouldCreateCycle(node.effectSource));
	}

	function wouldCreateCycle(source: EffectSource): boolean {
		if (source.type === 'inlineCustomNodeGraphEffect') return hasCyclicNode(source.customNodeGraphEffect);
		if (source.type !== 'customNodeGraphEffectReference') return false;
		const known = cyclic.get(source.id);
		if (known != null) return known;

		// 探索中の ID へ戻った場合も循環。未接続・バイパスのノードも後から有効にできるので対象に含める。
		cyclic.set(source.id, true);
		const graph = graphs.get(source.id);
		const result = graph != null && hasCyclicNode(graph);
		cyclic.set(source.id, result);
		return result;
	}

	return wouldCreateCycle;
}
