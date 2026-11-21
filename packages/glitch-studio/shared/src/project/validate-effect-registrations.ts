import type { ProjectEffectRegistrations } from './types.ts';

/** 定義の索引を作る前に、編集・読み込み・書き出し側でIDの一意性を確定する。 */
export function validateProjectEffectRegistrations(project: ProjectEffectRegistrations): void {
	for (const [kind, entries] of [
		['Custom Shader Effect', project.customShaderEffects],
		['Custom Node Graph Effect', project.customNodeGraphEffects],
	] as const) {
		if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate ' + kind + ' ID');
	}
}
