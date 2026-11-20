import type { EffectInstance } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { CustomNodeGraphEffectValueChange } from './project-change-policy.ts';

export function customNodeGraphEffectValueChangeKey(change: CustomNodeGraphEffectValueChange): string {
	const target = 'customNodeGraphEffectId' in change ? change.customNodeGraphEffectId : [change.sceneId, change.layerId];
	return JSON.stringify([target, change.type === 'node' ? change.node.id : null]);
}

/** 初期化中・タイル描画中に届いた編集を、配置ごとに次のフレームの準備直前まで保持する。 */
export class PendingCustomNodeGraphEffectValues {
	private readonly changes = new Map<string, CustomNodeGraphEffectValueChange>();

	constructor(private readonly inlineOwner: { sceneId: string; layerId: string } | null) {}

	public get edits() { return this.changes.values(); }

	public enqueue(change: CustomNodeGraphEffectValueChange) {
		if ('sceneId' in change && (this.inlineOwner?.sceneId !== change.sceneId || this.inlineOwner.layerId !== change.layerId)) return;
		this.changes.set(customNodeGraphEffectValueChangeKey(change), change);
	}

	public applyTo(instance: EffectInstance) {
		for (const change of this.changes.values()) {
			const registrationId = 'customNodeGraphEffectId' in change ? change.customNodeGraphEffectId : null;
			instance.updateCustomNodeGraphEffectValues(registrationId, change.type === 'node'
				? { nodeId: change.node.id, params: change.node.params }
				: { customParameterValues: change.customNodeGraphEffect.customParameterValues });
		}
		this.changes.clear();
	}
}
