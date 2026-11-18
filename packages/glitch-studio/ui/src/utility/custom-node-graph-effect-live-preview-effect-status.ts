import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { CustomNodeGraphEffectLivePreviewEffectStatusSource } from '@gs/glitch-studio_renderer/custom-node-graph-effect-renderer-manager.ts';

export class CustomNodeGraphEffectLivePreviewEffectStateStore {
	private current: { customNodeGraphEffectId: string; instanceId: string } | null = null;
	private statuses: Map<string, EffectInstanceState>;

	constructor(statuses: Map<string, EffectInstanceState>) {
		this.statuses = statuses;
	}

	public start(customNodeGraphEffectId: string, instanceId: string) {
		this.current = { customNodeGraphEffectId, instanceId };
		this.statuses.clear();
	}

	public stop() {
		this.current = null;
		this.statuses.clear();
	}

	public update(source: CustomNodeGraphEffectLivePreviewEffectStatusSource, nodeId: string, status: EffectInstanceState | null) {
		// 同じノードIDでもタイムラインレイヤーや以前のCustom Node Graph Effect Live Previewインスタンスは別の状態を持つ。
		const current = this.current;
		if (current == null || source.type !== 'customNodeGraphEffectLivePreview' || source.instanceId !== current.instanceId
			|| source.customNodeGraphEffectId !== current.customNodeGraphEffectId) return;
		if (status) this.statuses.set(nodeId, status);
		else this.statuses.delete(nodeId);
	}

	public get(customNodeGraphEffectId: string, nodeId: string): EffectInstanceState | null {
		if (this.current?.customNodeGraphEffectId !== customNodeGraphEffectId) return null;
		return this.statuses.get(nodeId) ?? null;
	}
}
