import type { EffectInstance } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { NodesEffectValueChange } from './project-change-policy.ts';

export function nodesEffectValueChangeKey(change: NodesEffectValueChange): string {
	const target = 'nodesEffectId' in change ? change.nodesEffectId : [change.sceneId, change.layerId];
	return JSON.stringify([target, change.type === 'node' ? change.node.id : null]);
}

/** 初期化中・タイル描画中に届いた編集を、配置ごとに次のフレームの準備直前まで保持する。 */
export class PendingNodesEffectValues {
	private readonly changes = new Map<string, NodesEffectValueChange>();

	constructor(private readonly inlineOwner: { sceneId: string; layerId: string } | null) {}

	public get edits() { return this.changes.values(); }

	public enqueue(change: NodesEffectValueChange) {
		if ('sceneId' in change && (this.inlineOwner?.sceneId !== change.sceneId || this.inlineOwner.layerId !== change.layerId)) return;
		// 値の変更は対象ごとのスナップショットなので、描画中に重なった編集は最新の値にまとめる。
		this.changes.set(nodesEffectValueChangeKey(change), change);
	}

	public applyTo(instance: EffectInstance) {
		for (const change of this.changes.values()) {
			const registrationId = 'nodesEffectId' in change ? change.nodesEffectId : null;
			instance.updateNodesEffectValues(registrationId, change.type === 'node'
				? { nodeId: change.node.id, params: change.node.params }
				: { customParameterValues: change.nodesEffect.customParameterValues });
		}
		this.changes.clear();
	}
}
