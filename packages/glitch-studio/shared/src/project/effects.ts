import type { EffectDefinitions } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { ProjectEffectRegistrations } from './types.ts';

export type NativeEffectDefinitions = Readonly<Record<string, ReturnType<EffectDefinitions['getNativeEffect']>>>;

function indexDefinitions<T>(entries: readonly { id: string; definition: T }[]): (id: string) => T {
	const definitions = new Map(entries.map(entry => [entry.id, entry.definition]));
	return id => definitions.get(id)!;
}

/**
 * プロジェクトごとに登録定義の索引を持ち、Native Effectの定義一覧は読み取り専用で共有する。
 * 同じ文字列IDでもEffectの種類ごとに独立して解決する。
 * 登録IDの一意性と参照先の存在は編集・読み込み・書き出し時に保証し、描画時には再検証しない。
 */
export function createProjectEffectDefinitions(project: ProjectEffectRegistrations, nativeDefinitions: NativeEffectDefinitions): EffectDefinitions {
	const nativeEffects = new Map(Object.entries(nativeDefinitions));
	return {
		getNativeEffect: id => nativeEffects.get(id)!,
		getCustomShaderEffect: indexDefinitions(project.customShaderEffects),
		getNodesEffect: indexDefinitions(project.nodesEffects),
	};
}
