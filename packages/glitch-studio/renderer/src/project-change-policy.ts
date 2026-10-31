import type { VisualModuleNodeChange } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';

// 通知は編集内容だけを伝える。キャッシュと履歴をどこまで残すかは、Visual Module Live Previewと
// タイムラインが共通で使うレンダラー側の方針としてここに集約する。
export function canPreserveNodeStaticState(changes: readonly VisualModuleNodeChange[]): boolean {
	// 通常パラメータの値は解像度・静的リソースを変えず、出力キャッシュも値の比較で更新できる。
	// それ以外はVisual Module内の全エフェクトを再作成し、履歴もキャッシュも引き継がない。
	return changes.length > 0 && changes.every(change => change.type === 'parameter' && change.kind === 'value');
}

export function canPreserveTimelineLayerInstance(changes: readonly TimelineLayerChange[]): boolean {
	// Visual Module引数とカスタムパラメータの値は次の評価で読み直す。
	// 値だけの編集でインスタンスを破棄すると、未使用の値でもFeedbackの履歴を失う。
	return changes.length > 0 && changes.every(change => change.type === 'parameter'
		&& (change.target === 'module' || change.target === 'customParameter') && change.kind === 'value');
}
