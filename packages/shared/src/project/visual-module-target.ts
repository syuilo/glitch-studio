// Moduleは自身の配置先を知らない。登録・Scene内の所在はプロジェクト側で付加する。
export type VisualModuleTarget =
	| { visualModuleId: string }
	| { sceneId: string; inlineVisualModuleLayerId: string };

export function visualModuleTargetKey(target: VisualModuleTarget): string {
	return 'visualModuleId' in target ? JSON.stringify(['module', target.visualModuleId])
		: JSON.stringify(['inline', target.sceneId, target.inlineVisualModuleLayerId]);
}
