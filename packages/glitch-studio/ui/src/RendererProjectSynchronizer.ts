import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { customNodeGraphEffectTargetKey } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import { getRendererLayerState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { findCustomNodeGraphEffect } from './utility/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { ProjectContentChange, ProjectContext } from './Project.ts';

function mergeChanges<T>(previous: readonly T[], next: readonly T[]): T[] {
	return [...new Map([...previous, ...next].map(change => [JSON.stringify(change), change])).values()];
}

/** コマンドは変更対象・内容を通知する。同じターンの連続編集は最終値を一度だけ送る。 */
export class RendererProjectSynchronizer {
	private pending = new Map<string, ProjectContentChange>();
	private scheduled = false;
	private disposed = false;
	private unsubscribe: () => void;
	private inFlight: Promise<void> = Promise.resolve();

	constructor(private manager: ProjectContext['stateManager'], private destination: {
		apply: (changes: RendererProjectChange[]) => Promise<void>;
		onUpdated: () => void;
		onError: (error: unknown) => void;
	}) {
		this.unsubscribe = manager.onChange(changes => {
			// Assets・Players・プロジェクト解像度・タイムライン描画設定は専用同期経路が扱い、表示名は送らない。
			// どの通知を描画へ送るかは、状態管理ではなくこの購読側で選ぶ。
			const targets = changes.filter((change): change is ProjectContentChange =>
				change.type === 'customShaderEffect' || change.type === 'automationGraphs' || change.type === 'node' || change.type === 'customNodeGraphEffect' || change.type === 'customNodeGraphEffectRegistration' || change.type === 'layer' || change.type === 'layerTree' || change.type === 'layerOrder' || change.type === 'scene');
			for (let target of targets) {
				const key = target.type === 'customShaderEffect' || target.type === 'automationGraphs' ? target.type : target.type === 'node' ? JSON.stringify([target.type, customNodeGraphEffectTargetKey(target.target), target.nodeId])
					: target.type === 'customNodeGraphEffect' ? JSON.stringify([target.type, customNodeGraphEffectTargetKey(target.target)])
					: target.type === 'customNodeGraphEffectRegistration' ? JSON.stringify([target.type, target.customNodeGraphEffectId])
					: JSON.stringify([target.type, target.sceneId, target.type === 'layer' ? target.layerId : null]);
				const previous = this.pending.get(key);
				// 同じ種類の連続編集はまとめるが、途中の配列操作や接続変更などは捨てない。
				// 最終値と全ての変更種別を渡し、破棄範囲の判断はレンダラーへ委ねる。
				if (target.type === 'node' && previous?.type === 'node') target = { ...target, changes: mergeChanges(previous.changes, target.changes) };
				if (target.type === 'layer' && previous?.type === 'layer') target = { ...target, changes: mergeChanges(previous.changes, target.changes) };
				if (target.type === 'customNodeGraphEffect' && previous?.type === 'customNodeGraphEffect') target = { ...target, customParameterValuesOnly: target.customParameterValuesOnly === true && previous.customParameterValuesOnly === true };
				this.pending.set(key, target);
			}
			if (this.scheduled || targets.length === 0) return;
			this.scheduled = true;
			queueMicrotask(() => { this.scheduled = false; void this.flush().catch(error => this.destination.onError(error)); });
		});
	}

	private createChanges(targets: readonly ProjectContentChange[]): RendererProjectChange[] {
		if (targets.some(target => target.type === 'customShaderEffect')) {
			// コマンドが補正した全配置を含め、同じターンの他の編集も最終状態へまとめる。
			const state = this.manager.state;
			return [{ type: 'customShaderEffects', customShaderEffects: state.customShaderEffects.value, project: {
				automationGraphs: state.automationGraphs.value, customNodeGraphEffects: state.customNodeGraphEffects.value, timelineScenes: state.timelineScenes.value,
			} }];
		}
		const scenes = new Set(targets.filter(target => target.type === 'scene').map(target => target.sceneId));
		const layerTrees = new Set(targets.filter(target => target.type === 'layerTree').map(target => target.sceneId));
		// 追加・削除・置換されたレイヤーでは、内部Moduleもレイヤーの最終状態に含まれる。
		// 部分編集同士ならModuleの変更種別も残すため、個別通知を吸収しない。
		const layers = new Set(targets.flatMap(target => target.type === 'layer' && target.changes.some(change => change.type === 'definition') ? [JSON.stringify([target.sceneId, target.layerId])] : []));
		const updatedCustomNodeGraphEffectTargetKeys = new Set(targets.flatMap(target => target.type === 'customNodeGraphEffect' && target.customParameterValuesOnly !== true ? [customNodeGraphEffectTargetKey(target.target)] : []));
		const registeredCustomNodeGraphEffectIds = new Set(targets.filter(target => target.type === 'customNodeGraphEffectRegistration').map(target => target.customNodeGraphEffectId));
		const changes: RendererProjectChange[] = [];
		for (const target of targets) {
			if (target.type === 'customShaderEffect') continue;
			if (target.type === 'automationGraphs') {
				changes.push({ type: 'automationGraphs', automationGraphs: this.manager.state.automationGraphs.value });
			} else if (target.type === 'customNodeGraphEffectRegistration') {
				changes.push({ ...target, customNodeGraphEffect: this.manager.state.customNodeGraphEffects.value.find(customNodeGraphEffect => customNodeGraphEffect.id === target.customNodeGraphEffectId) ?? null });
			} else if (target.type === 'node' || target.type === 'customNodeGraphEffect') {
				const customNodeGraphEffectTarget = target.target;
				// 追加直後の編集や同じターンのUndoは、登録の最終状態へまとめる。
				if ('customNodeGraphEffectId' in customNodeGraphEffectTarget && registeredCustomNodeGraphEffectIds.has(customNodeGraphEffectTarget.customNodeGraphEffectId)) continue;
				if (!('customNodeGraphEffectId' in customNodeGraphEffectTarget) && (scenes.has(customNodeGraphEffectTarget.sceneId) || layers.has(JSON.stringify([customNodeGraphEffectTarget.sceneId, customNodeGraphEffectTarget.inlineCustomNodeGraphEffectLayerId])))) continue;
				if (target.type === 'node' && updatedCustomNodeGraphEffectTargetKeys.has(customNodeGraphEffectTargetKey(customNodeGraphEffectTarget))) continue;
				const customNodeGraphEffect = findCustomNodeGraphEffect(this.manager.state, customNodeGraphEffectTarget);
				// 編集後にグループごと削除された子への差分は送らない。残った子の編集は
				// 階層スナップショットに含まれていても、描画履歴の判定に必要なので維持する。
				if (!customNodeGraphEffect && !('customNodeGraphEffectId' in customNodeGraphEffectTarget) && layerTrees.has(customNodeGraphEffectTarget.sceneId)) continue;
				if (!customNodeGraphEffect) throw new Error('Changed Custom Node Graph Effect not found');
				// コマンドpayloadには新しい値等も含まれる。通信では所在を示すIDだけを使う。
				const address: CustomNodeGraphEffectTarget = 'customNodeGraphEffectId' in customNodeGraphEffectTarget ? { customNodeGraphEffectId: customNodeGraphEffectTarget.customNodeGraphEffectId }
					: { sceneId: customNodeGraphEffectTarget.sceneId, inlineCustomNodeGraphEffectLayerId: customNodeGraphEffectTarget.inlineCustomNodeGraphEffectLayerId };
				if (target.type === 'customNodeGraphEffect') changes.push({ type: 'customNodeGraphEffect', target: address, customNodeGraphEffect, ...(target.customParameterValuesOnly === true ? { customParameterValuesOnly: true } : {}) });
				else {
					const node = customNodeGraphEffect.nodes.find(node => node.id === target.nodeId);
					if (!node) throw new Error('Changed node not found');
					changes.push({
						type: 'node',
						target: address,
						node,
						changes: target.changes,
					});
				}
			} else {
				if (target.type !== 'scene' && scenes.has(target.sceneId)) continue;
				const scene = this.manager.state.timelineScenes.value.find(scene => scene.id === target.sceneId);
				if (target.type === 'scene') changes.push({ type: 'scene', sceneId: target.sceneId, scene: scene ?? null });
				else if (!scene) throw new Error('Changed scene not found');
				else if (target.type === 'layer') {
					const layer = findTimelineLayer(scene.layers, target.layerId);
					changes.push({ ...target, layer: layer ? getRendererLayerState(layer) : null });
				} else if (target.type === 'layerTree') changes.push({ ...target, layers: scene.layers });
				else if (!layerTrees.has(target.sceneId)) changes.push({ ...target, layerIds: scene.layers.map(layer => layer.id) });
			}
		}
		// 階層を先に反映し、新しい所属先へのノード編集→引数更新→順序の順で適用する。
		const rank = (change: RendererProjectChange) => change.type === 'layerTree' ? -1 : change.type === 'layerOrder' ? 2 : change.type === 'layer' ? 1 : 0;
		changes.sort((a, b) => rank(a) - rank(b));
		return changes;
	}

	public async flush(): Promise<void> {
		if (this.disposed || this.pending.size === 0) return this.inFlight;
		const targets = [...this.pending.values()];
		this.pending.clear();
		const changes = this.createChanges(targets);
		const update = this.destination.apply(deepClone(changes)).then(() => {
			if (!this.disposed) this.destination.onUpdated();
		}, error => {
			// 同期は差分の送信だけを担当する。失敗後の破棄・再生成はエンジンの所有者に委ねる。
			if (!this.disposed) this.destination.onError(error);
		});
		const pending = Promise.all([this.inFlight, update]).then(() => {});
		this.inFlight = pending;
		void pending.finally(() => { if (this.inFlight === pending) this.inFlight = Promise.resolve(); }).catch(() => {});
		return pending;
	}

	public dispose() {
		this.disposed = true;
		this.pending.clear();
		this.unsubscribe();
	}
}
