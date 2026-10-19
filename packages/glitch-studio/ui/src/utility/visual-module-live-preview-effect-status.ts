import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { LivePreviewEffectStatusSource } from '@gs/glitch-studio_renderer/visual-module-renderer-manager.ts';

export class VisualModuleLivePreviewEffectStateStore {
	private current: { visualModuleId: string; instanceId: string } | null = null;
	private statuses: Map<string, EffectInstanceState>;

	constructor(statuses: Map<string, EffectInstanceState>) {
		this.statuses = statuses;
	}

	public start(visualModuleId: string, instanceId: string) {
		this.current = { visualModuleId, instanceId };
		this.statuses.clear();
	}

	public stop() {
		this.current = null;
		this.statuses.clear();
	}

	public update(source: LivePreviewEffectStatusSource, nodeId: string, status: EffectInstanceState | null) {
		// 同じノードIDでもタイムラインレイヤーや以前のVisual Module Live Previewインスタンスは別の状態を持つ。
		const current = this.current;
		if (current == null || source.type !== 'livePreview' || source.instanceId !== current.instanceId
			|| source.visualModuleId !== current.visualModuleId) return;
		if (status) this.statuses.set(nodeId, status);
		else this.statuses.delete(nodeId);
	}

	public get(visualModuleId: string, nodeId: string): EffectInstanceState | null {
		if (this.current?.visualModuleId !== visualModuleId) return null;
		return this.statuses.get(nodeId) ?? null;
	}
}
