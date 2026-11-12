import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type { ProjectSessionContext } from './ProjectSessionContext.ts';

// アクティブなプロジェクトを後から引き直さず、画面の生成時に操作対象を固定する。
// ポップアップも同じキーを提供し、呼び出し元の編集セッションを引き継ぐ。
export const projectSessionKey: InjectionKey<ProjectSessionContext | null> = Symbol('projectSession');

export function useProjectSession(): ProjectSessionContext {
	const projectSession = inject(projectSessionKey, null);
	if (projectSession == null) throw new Error('A project session must be provided to this editor.');
	return projectSession;
}
