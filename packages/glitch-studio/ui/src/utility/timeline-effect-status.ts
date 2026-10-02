import { shallowReactive } from 'vue';
import type { EffectInstanceState } from '@gs/shared/effect/effect-status.ts';
import type { TimelineLayerStatusSource } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';

/** 同じ定義・レイヤーIDでも、配置パスとクリップの実行インスタンスごとに状態を分離する。 */
export class TimelineEffectStateStore {
	private nodeStates = shallowReactive(new Map<string, { instanceId: string; states: Map<string, EffectInstanceState> }>());
	private layerStates = shallowReactive(new Map<string, { instanceId: string; state: EffectInstanceState }>());

	public updateNode(source: TimelineLayerStatusSource, nodeId: string, status: EffectInstanceState | null) {
		const key = JSON.stringify([source.rootSceneId, ...source.layerPath]);
		let entry = this.nodeStates.get(key);
		if (status == null) {
			// 旧クリップの破棄通知で、同じレイヤーの新しい描画状態を消さない。
			if (entry?.instanceId === source.instanceId) {
				entry.states.delete(nodeId);
				if (entry.states.size === 0) this.nodeStates.delete(key);
			}
			return;
		}
		if (entry?.instanceId !== source.instanceId) {
			entry = { instanceId: source.instanceId, states: shallowReactive(new Map()) };
			this.nodeStates.set(key, entry);
		}
		entry.states.set(nodeId, status);
	}

	public updateLayer(source: TimelineLayerStatusSource, status: EffectInstanceState | null) {
		const key = JSON.stringify([source.rootSceneId, ...source.layerPath]);
		const entry = this.layerStates.get(key);
		if (status != null) {
			this.layerStates.set(key, { instanceId: source.instanceId, state: status });
		} else if (entry?.instanceId === source.instanceId) {
			// TimelineRendererは描画失敗時にもリソースを破棄する。そのnull通知で
			// 原因まで消さず、復旧・設定更新までは最後のエラーを表示する。
			// 破棄した出力の寸法は表示しない。
			if (entry.state.status.type === 'error') {
				this.layerStates.set(key, { ...entry, state: { status: entry.state.status,
					outputs: Object.fromEntries(Object.keys(entry.state.outputs).map(port => [port, null])) } });
			} else {
				this.layerStates.delete(key);
			}
		}
	}

	public clearLayerErrors() {
		for (const [key, entry] of this.layerStates) {
			if (entry.state.status.type === 'error') this.layerStates.delete(key);
		}
	}

	public getNodes(sceneId: string, layerId: string): ReadonlyMap<string, EffectInstanceState> | undefined {
		return this.nodeStates.get(JSON.stringify([sceneId, layerId]))?.states;
	}

	public getLayer(sceneId: string, layerId: string): EffectInstanceState | undefined {
		return this.layerStates.get(JSON.stringify([sceneId, layerId]))?.state;
	}

	public clear() {
		this.nodeStates.clear();
		this.layerStates.clear();
	}
}
