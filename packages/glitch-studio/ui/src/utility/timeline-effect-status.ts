import { shallowReactive } from 'vue';
import type { EffectPreparationStatus } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { TimelineLayerStatusSource } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';

/** 同じ定義・レイヤーIDでも、配置パスとクリップの実行インスタンスごとに状態を分離する。 */
export class TimelineEffectStateStore {
	private layerStates = shallowReactive(new Map<string, { instanceId: string; state: EffectPreparationStatus }>());

	public updateLayer(source: TimelineLayerStatusSource, status: EffectPreparationStatus | null) {
		const key = JSON.stringify([source.rootSceneId, ...source.layerPath]);
		const entry = this.layerStates.get(key);
		if (status != null) {
			this.layerStates.set(key, { instanceId: source.instanceId, state: status });
		} else if (entry?.instanceId === source.instanceId) {
			// 旧クリップの破棄通知で、新しい実行インスタンスの状態を消さない。
			this.layerStates.delete(key);
		}
	}

	public getLayer(sceneId: string, layerId: string): EffectPreparationStatus | null {
		return this.layerStates.get(JSON.stringify([sceneId, layerId]))?.state ?? null;
	}

	public clear() {
		this.layerStates.clear();
	}
}
