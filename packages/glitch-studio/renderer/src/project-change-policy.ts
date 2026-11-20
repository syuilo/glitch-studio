import type { CustomNodeGraphEffectNodeChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { CustomNodeGraphEffectEffectNode } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';

export type CustomNodeGraphEffectValueChange =
	| (Extract<RendererProjectChange, { type: 'node' }> & { node: CustomNodeGraphEffectEffectNode; changes: { type: 'parameter'; kind: 'value' }[] })
	| (Extract<RendererProjectChange, { type: 'customNodeGraphEffect' }> & { customParameterValuesOnly: true });

/** 描画資源と配線を変えず、実行中フレームの完了後にまとめて反映できる変更。 */
export function isCustomNodeGraphEffectValueChange(change: RendererProjectChange): change is CustomNodeGraphEffectValueChange {
	return change.type === 'node' ? change.node.type !== 'relay' && canPreserveNodeStaticState(change.changes)
		: change.type === 'customNodeGraphEffect' && change.customParameterValuesOnly === true;
}

function canPreserveNodeStaticState(changes: readonly CustomNodeGraphEffectNodeChange[]): boolean {
	return changes.length > 0 && changes.every(change => change.type === 'parameter' && change.kind === 'value');
}

export function canPreserveTimelineLayerInstance(changes: readonly TimelineLayerChange[]): boolean {
	return changes.length > 0 && changes.every(change => change.type === 'solo' || (change.type === 'parameter'
		&& (change.target === 'effect' || change.target === 'publicParameter') && change.kind === 'value'));
}
