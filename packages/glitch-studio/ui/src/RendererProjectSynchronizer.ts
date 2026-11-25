import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { nodesEffectTargetKey } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';
import { getRendererLayerState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { findNodesEffectOwner } from './utility/nodes-effect-target.ts';
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
			// Assets・プロジェクト解像度・タイムライン描画設定は専用同期経路が扱い、表示名は送らない。
			// どの通知を描画へ送るかは、状態管理ではなくこの購読側で選ぶ。
			const targets = changes.filter((change): change is ProjectContentChange =>
				change.type === 'customShaderEffect' || change.type === 'curveAnimations' || change.type === 'node' || change.type === 'nodesEffect' || change.type === 'nodesEffectRegistration' || change.type === 'layer' || change.type === 'layerTree' || change.type === 'layerOrder' || change.type === 'scene');
			for (let target of targets) {
				const key = target.type === 'customShaderEffect' ? JSON.stringify([target.type, target.customShaderEffectId]) : target.type === 'curveAnimations' ? target.type : target.type === 'node' ? JSON.stringify([target.type, nodesEffectTargetKey(target.target), target.nodeId])
					: target.type === 'nodesEffect' ? JSON.stringify([target.type, nodesEffectTargetKey(target.target)])
					: target.type === 'nodesEffectRegistration' ? JSON.stringify([target.type, target.nodesEffectId])
					: JSON.stringify([target.type, target.sceneId, target.type === 'layer' ? target.layerId : null]);
				const previous = this.pending.get(key);
				// 同じ種類の連続編集はまとめるが、途中の配列操作や接続変更などは捨てない。
				// 最終値と全ての変更種別を渡し、破棄範囲の判断はレンダラーへ委ねる。
				if (target.type === 'node' && previous?.type === 'node') target = { ...target, changes: mergeChanges(previous.changes, target.changes) };
				if (target.type === 'layer' && previous?.type === 'layer') target = { ...target, changes: mergeChanges(previous.changes, target.changes) };
				if (target.type === 'nodesEffect' && previous?.type === 'nodesEffect') target = { ...target, customParameterValuesOnly: target.customParameterValuesOnly === true && previous.customParameterValuesOnly === true };
				this.pending.set(key, target);
			}
			if (this.scheduled || targets.length === 0) return;
			this.scheduled = true;
			queueMicrotask(() => { this.scheduled = false; void this.flush().catch(error => this.destination.onError(error)); });
		});
	}

	private createChanges(targets: readonly ProjectContentChange[]): RendererProjectChange[] {
		const scenes = new Set(targets.filter(target => target.type === 'scene').map(target => target.sceneId));
		const layerTrees = new Set(targets.filter(target => target.type === 'layerTree').map(target => target.sceneId));
		// 追加・削除・置換される所有レイヤーはインライン定義も含む。それ以外の編集では、
		// レイヤー引数と内部ノードそれぞれの変更種別を残し、描画履歴の扱いを受信側に伝える。
		const replacedLayers = new Set(targets.flatMap(target => target.type === 'layer' && target.changes.some(change => change.type === 'definition')
			? [nodesEffectTargetKey(target)] : []));
		const updatedNodesEffectTargetKeys = new Set(targets.flatMap(target => target.type === 'nodesEffect' && target.customParameterValuesOnly !== true ? [nodesEffectTargetKey(target.target)] : []));
		const registeredNodesEffectIds = new Set(targets.filter(target => target.type === 'nodesEffectRegistration').map(target => target.nodesEffectId));
		const changes: RendererProjectChange[] = [];
		for (const target of targets) {
			if (target.type === 'customShaderEffect') {
				const { customShaderEffectId } = target;
				changes.push({ type: 'customShaderEffectRegistration', customShaderEffectId, customShaderEffect: this.manager.state.customShaderEffects.value.find(entry => entry.id === customShaderEffectId) ?? null });
				continue;
			}
			if (target.type === 'curveAnimations') {
				changes.push({ type: 'curveAnimations', curveAnimations: this.manager.state.curveAnimations.value });
			} else if (target.type === 'nodesEffectRegistration') {
				changes.push({ ...target, nodesEffect: this.manager.state.nodesEffects.value.find(nodesEffect => nodesEffect.id === target.nodesEffectId) ?? null });
			} else if (target.type === 'node' || target.type === 'nodesEffect') {
				const nodesEffectTarget = target.target;
				// 追加直後の編集や同じターンのUndoは、登録の最終状態へまとめる。
				if ('nodesEffectId' in nodesEffectTarget && registeredNodesEffectIds.has(nodesEffectTarget.nodesEffectId)) continue;
				if ('sceneId' in nodesEffectTarget && (scenes.has(nodesEffectTarget.sceneId) || replacedLayers.has(nodesEffectTargetKey(nodesEffectTarget)))) continue;
				if (target.type === 'node' && updatedNodesEffectTargetKeys.has(nodesEffectTargetKey(nodesEffectTarget))) continue;
				// 階層の編集で消えた子の差分を省き、残った子は描画履歴の扱いを判断できるよう変更種別を残す。
				const owner = findNodesEffectOwner(this.manager.state, nodesEffectTarget);
				if (owner == null) {
					if ('sceneId' in nodesEffectTarget && layerTrees.has(nodesEffectTarget.sceneId)) continue;
					throw new Error('Changed Nodes Effect not found');
				}
				const nodesEffect = 'definition' in owner ? owner.definition : owner.nodesEffect;
				const address = 'nodesEffectId' in nodesEffectTarget ? { nodesEffectId: nodesEffectTarget.nodesEffectId }
					: { sceneId: nodesEffectTarget.sceneId, layerId: nodesEffectTarget.layerId };
				if (target.type === 'nodesEffect') {
					if (target.customParameterValuesOnly === true) {
						const { customParameterValues } = nodesEffect;
						changes.push({ ...address, type: 'nodesEffect', customParameterValuesOnly: true, nodesEffect: { customParameterValues } });
					} else changes.push({ ...address, type: 'nodesEffect', nodesEffect });
				} else {
					const node = nodesEffect.nodes.find(node => node.id === target.nodeId);
					if (!node) throw new Error('Changed node not found');
					changes.push({
						type: 'node',
						...address,
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
