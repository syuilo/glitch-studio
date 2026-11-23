import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';
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
		...changedRegistrations(previous.nodesEffects, next.nodesEffects).map(([id, entry]) =>
			({ type: 'nodesEffectRegistration' as const, nodesEffectId: id, nodesEffect: entry })),
	];
}

/** 指定の変更が影響する配置を、インライン定義・登録参照の入れ子までたどる。 */
export function changedEffectReferences(changes: Iterable<RendererProjectChange>, project: ProjectEffectRegistrations) {
	const shaders = new Set<string>();
	const changedNodesEffectIds = new Set<string>();
	for (const change of changes) {
		if (change.type === 'customShaderEffectRegistration') shaders.add(change.customShaderEffectId);
		if ('nodesEffectId' in change) changedNodesEffectIds.add(change.nodesEffectId);
	}
	if (shaders.size === 0 && changedNodesEffectIds.size === 0) return null;
	const registered = new Map(project.nodesEffects.map(entry => [entry.id, entry.definition]));
	const results = new Map<NodesEffect, boolean>();

	function usesChangedNodesEffect(nodesEffect: NodesEffect): boolean {
		const cached = results.get(nodesEffect);
		if (cached != null) return cached;
		const changed = nodesEffect.nodes.some(node => node.type !== 'relay' && usesChangedEffect(node.effectSource));
		results.set(nodesEffect, changed);
		return changed;
	}

	function usesChangedEffect(source: EffectSource): boolean {
		switch (source.type) {
			case 'nativeEffect':
			case 'inlineCustomShaderEffect': return false;
			case 'customShaderEffectReference': return shaders.has(source.id);
			case 'inlineNodesEffect': return usesChangedNodesEffect(source.nodesEffect);
			case 'nodesEffectReference': {
				const nodesEffect = registered.get(source.id);
				return changedNodesEffectIds.has(source.id) || (nodesEffect != null && usesChangedNodesEffect(nodesEffect));
			}
		}
	}

	return usesChangedEffect;
}
