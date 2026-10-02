import type { VisualModuleNodeChange } from '@gs/shared/visual-module/types.ts';
import type { TimelineLayerChange } from '@gs/shared/timeline/types.ts';

// 通知は編集内容だけを伝える。キャッシュと履歴をどこまで残すかは、LIVEと
// タイムラインが共通で使うレンダラー側の方針としてここに集約する。
export function canPreserveNodeOutputCache(changes: readonly VisualModuleNodeChange[]): boolean {
	// 値の編集は既存キーとの比較で依存先へ伝播する。それ以外はModule単位で
	// 無効化することで、構造の差分から依存関係を追い直す仕組みを増やさない。
	return changes.length > 0 && changes.every(change => change.type === 'parameter' && change.kind === 'value');
}

export function canPreserveModuleLayerInstance(changes: readonly TimelineLayerChange[]): boolean {
	// Module引数の値は内部ノードのキーで比較できる。その他のレイヤー編集では、
	// 対象配置の再生成を許容し、別レイヤーの履歴・リソースは維持する。
	return changes.length > 0 && changes.every(change => change.type === 'parameter' && change.target === 'module' && change.kind === 'value');
}
