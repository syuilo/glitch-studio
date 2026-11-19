import type { CustomNodeGraphEffectNodeChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';

export type CustomNodeGraphEffectValueChange = Extract<RendererProjectChange, { type: 'node' | 'customNodeGraphEffect' }>;

/** 描画資源と配線を変えず、実行中フレームの完了後にまとめて反映できる変更。 */
export function isCustomNodeGraphEffectValueChange(change: RendererProjectChange): change is CustomNodeGraphEffectValueChange {
	return change.type === 'node' ? canPreserveNodeStaticState(change.changes)
		: change.type === 'customNodeGraphEffect' && change.customParameterValuesOnly === true;
}

function canPreserveNodeStaticState(changes: readonly CustomNodeGraphEffectNodeChange[]): boolean {
	return changes.length > 0 && changes.every(change => change.type === 'parameter' && change.kind === 'value');
}

export function canPreserveTimelineLayerInstance(changes: readonly TimelineLayerChange[]): boolean {
	return changes.length > 0 && changes.every(change => change.type === 'solo' || (change.type === 'parameter'
		&& (change.target === 'effect' || change.target === 'publicParameter') && change.kind === 'value'));
}
