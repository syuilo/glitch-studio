import type { NodesEffectNodeChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { NodesEffectEffectNode } from '@gs/subsystems_effect_shared/nodes-effect.ts';

export type NodesEffectValueChange =
	| (Extract<RendererProjectChange, { type: 'node' }> & { node: NodesEffectEffectNode; changes: { type: 'parameter'; kind: 'value' }[] })
	| (Extract<RendererProjectChange, { type: 'nodesEffect' }> & { customParameterValuesOnly: true });

/** 描画資源と配線を変えず、実行中フレームの完了後にまとめて反映できる変更。 */
export function isNodesEffectValueChange(change: RendererProjectChange): change is NodesEffectValueChange {
	return change.type === 'node' ? change.node.type !== 'relay' && canPreserveNodeStaticState(change.changes)
		: change.type === 'nodesEffect' && change.customParameterValuesOnly === true;
}

function canPreserveNodeStaticState(changes: readonly NodesEffectNodeChange[]): boolean {
	return changes.length > 0 && changes.every(change => change.type === 'parameter' && change.kind === 'value');
}

/** Effectや公開パラメータの値だけを編集した場合はFeedbackなどの描画履歴を維持する。Soloは評価時の参加判定だけを変更する。 */
export function canPreserveTimelineLayerInstance(changes: readonly TimelineLayerChange[]): boolean {
	return changes.length > 0 && changes.every(change => change.type === 'solo' || (change.type === 'parameter'
		&& (change.target === 'effect' || change.target === 'publicParameter') && change.kind === 'value'));
}
