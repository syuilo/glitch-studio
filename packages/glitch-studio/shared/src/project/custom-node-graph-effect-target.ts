// Custom Node Graph Effectは自身の配置先を知らない。登録・Scene内の所在はプロジェクト側で付加する。
export type CustomNodeGraphEffectTarget =
	| { customNodeGraphEffectId: string }
	| { sceneId: string; layerId: string };

export function customNodeGraphEffectTargetKey(target: CustomNodeGraphEffectTarget): string {
	return 'customNodeGraphEffectId' in target ? JSON.stringify(['customNodeGraphEffect', target.customNodeGraphEffectId])
		: JSON.stringify(['inline', target.sceneId, target.layerId]);
}
