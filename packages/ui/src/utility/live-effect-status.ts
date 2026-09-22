import type { EffectStatus, EffectStatusSource } from '@glitch/shared/effect-status.ts';

export class LiveEffectStatusStore {
	private current: { visualModuleId: string; instanceId: string } | null = null;
	private statuses: Map<string, EffectStatus>;

	constructor(statuses: Map<string, EffectStatus>) {
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

	public update(source: EffectStatusSource, nodeId: string, status: EffectStatus | null) {
		// 同じノードIDでもタイムラインレイヤーや以前のLIVEインスタンスは別の状態を持つ。
		const current = this.current;
		if (current == null || source.type !== 'live' || source.instanceId !== current.instanceId
			|| source.visualModuleId !== current.visualModuleId) return;
		if (status) this.statuses.set(nodeId, status);
		else this.statuses.delete(nodeId);
	}

	public get(visualModuleId: string, nodeId: string): EffectStatus | undefined {
		if (this.current?.visualModuleId !== visualModuleId) return;
		return this.statuses.get(nodeId);
	}
}
