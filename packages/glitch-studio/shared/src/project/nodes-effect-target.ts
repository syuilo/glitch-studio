// Nodes Effectは自身の配置先を知らない。登録・Scene内の所在はプロジェクト側で付加する。
export type NodesEffectTarget =
	| { nodesEffectId: string }
	| { sceneId: string; layerId: string };

export function nodesEffectTargetKey(target: NodesEffectTarget): string {
	return 'nodesEffectId' in target ? JSON.stringify(['nodesEffect', target.nodesEffectId])
		: JSON.stringify(['inline', target.sceneId, target.layerId]);
}
