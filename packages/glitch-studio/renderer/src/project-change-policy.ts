import type { CustomNodeGraphEffectNodeChange } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';

export type CustomNodeGraphEffectValueChange = Extract<RendererProjectChange, { type: 'node' | 'customNodeGraphEffect' }>;

/** 描画資源と配線を変えず、実行中フレームの完了後にまとめて反映できる変更。 */
export function isCustomNodeGraphEffectValueChange(change: RendererProjectChange): change is CustomNodeGraphEffectValueChange {
	return change.type === 'node' ? canPreserveNodeStaticState(change.changes)
		: change.type === 'customNodeGraphEffect' && change.customParameterValuesOnly === true;
}

// 通知は編集内容だけを伝える。キャッシュと履歴をどこまで残すかは、Custom Node Graph Effect Live Previewと
// タイムラインが共通で使うレンダラー側の方針としてここに集約する。
export function canPreserveNodeStaticState(changes: readonly CustomNodeGraphEffectNodeChange[]): boolean {
	// 通常パラメータの値は解像度・静的リソースを変えず、出力キャッシュも値の比較で更新できる。
	// それ以外はCustom Node Graph Effect内の全エフェクトを再作成し、履歴もキャッシュも引き継がない。
	return changes.length > 0 && changes.every(change => change.type === 'parameter' && change.kind === 'value');
}

export function canPreserveTimelineLayerInstance(changes: readonly TimelineLayerChange[]): boolean {
	// Custom Node Graph Effect引数と公開パラメータの値は次の評価で読み直す。
	// 値だけの編集でインスタンスを破棄すると、未使用の値でもFeedbackの履歴を失う。
	// ソロも評価時の参加判定だけを変え、描画定義や静的リソースは変更しない。
	return changes.length > 0 && changes.every(change => change.type === 'solo' || (change.type === 'parameter'
		&& (change.target === 'customNodeGraphEffect' || change.target === 'publicParameter') && change.kind === 'value'));
}
