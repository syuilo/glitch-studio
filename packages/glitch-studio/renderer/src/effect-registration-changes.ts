import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { ProjectEffectRegistrations } from '@gs/glitch-studio_shared/project/types.ts';

// Worker越しのスナップショットは全オブジェクトが複製される。完全な一覧の同期時だけ
// 保存可能な定義を比較する。出力の宣言順も主出力省略時のポート選択に影響する。
function changedRegistrations<T extends { id: string; definition: unknown }>(previous: readonly T[], next?: readonly T[]): [string, T | null][] {
	if (next == null || next === previous) return [];
	const old = new Map(previous.map(entry => [entry.id, entry.definition]));
	const changes: [string, T | null][] = [];
	for (const entry of next) {
		const definition = old.get(entry.id);
		if (entry.definition !== definition && JSON.stringify(entry.definition) !== JSON.stringify(definition)) changes.push([entry.id, entry]);
		old.delete(entry.id);
	}
	for (const id of old.keys()) changes.push([id, null]);
	return changes;
}

export function diffEffectRegistrationSnapshots(previous: ProjectEffectRegistrations, next: Partial<ProjectEffectRegistrations>): RendererProjectChange[] {
	return [
		...changedRegistrations(previous.customShaderEffects, next.customShaderEffects).map(([id, entry]) =>
			({ type: 'customShaderEffectRegistration' as const, customShaderEffectId: id, customShaderEffect: entry })),
		...changedRegistrations(previous.customNodeGraphEffects, next.customNodeGraphEffects).map(([id, entry]) =>
			({ type: 'customNodeGraphEffectRegistration' as const, customNodeGraphEffectId: id, customNodeGraphEffect: entry })),
	];
}

/** 指定の変更が影響する配置を、インライン定義・登録参照の入れ子までたどる。 */
export function changedEffectReferences(changes: Iterable<RendererProjectChange>, project: ProjectEffectRegistrations) {
	const shaders = new Set<string>();
	const graphs = new Set<string>();
	for (const change of changes) {
		if (change.type === 'customShaderEffectRegistration') shaders.add(change.customShaderEffectId);
		if ('customNodeGraphEffectId' in change) graphs.add(change.customNodeGraphEffectId);
	}
	if (shaders.size === 0 && graphs.size === 0) return null;
	const registered = new Map(project.customNodeGraphEffects.map(entry => [entry.id, entry.definition]));
	const results = new Map<CustomNodeGraphEffect, boolean>();

	function usesChangedGraph(graph: CustomNodeGraphEffect): boolean {
		const cached = results.get(graph);
		if (cached != null) return cached;
		const changed = graph.nodes.some(node => node.type !== 'relay' && usesChangedEffect(node.effectSource));
		results.set(graph, changed);
		return changed;
	}

	function usesChangedEffect(source: EffectSource): boolean {
		switch (source.type) {
			case 'nativeEffect':
			case 'inlineCustomShaderEffect': return false;
			case 'customShaderEffectReference': return shaders.has(source.id);
			case 'inlineCustomNodeGraphEffect': return usesChangedGraph(source.customNodeGraphEffect);
			case 'customNodeGraphEffectReference': {
				const graph = registered.get(source.id);
				return graphs.has(source.id) || (graph != null && usesChangedGraph(graph));
			}
		}
	}

	return usesChangedEffect;
}
