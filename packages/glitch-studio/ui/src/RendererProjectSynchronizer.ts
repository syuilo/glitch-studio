import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { visualModuleTargetKey } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import { findVisualModule } from './utility/visual-module-target.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
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
		replace: (state: RendererProjectState) => Promise<void>;
		onUpdated: () => void;
		onError: (error: unknown) => void;
	}) {
		this.unsubscribe = manager.onChange(changes => {
			// Assets・Players・プロジェクト解像度・タイムライン描画設定は専用同期経路が扱い、表示名は送らない。
			// どの通知を描画へ送るかは、状態管理ではなくこの購読側で選ぶ。
			const targets = changes.filter((change): change is ProjectContentChange =>
				change.type === 'node' || change.type === 'visualModule' || change.type === 'layer' || change.type === 'layerOrder' || change.type === 'scene');
			for (let target of targets) {
				const key = target.type === 'node' ? JSON.stringify([target.type, visualModuleTargetKey(target.target), target.nodeId])
					: target.type === 'visualModule' ? JSON.stringify([target.type, visualModuleTargetKey(target.target)])
					: JSON.stringify([target.type, target.sceneId, target.type === 'layer' ? target.layerId : null]);
				const previous = this.pending.get(key);
				// 同じ種類の連続編集はまとめるが、途中の配列操作や接続変更などは捨てない。
				// 最終値と全ての変更種別を渡し、破棄範囲の判断はレンダラーへ委ねる。
				if (target.type === 'node' && previous?.type === 'node') target = { ...target, changes: mergeChanges(previous.changes, target.changes) };
				if (target.type === 'layer' && previous?.type === 'layer') target = { ...target, changes: mergeChanges(previous.changes, target.changes) };
				this.pending.set(key, target);
			}
			if (this.scheduled || targets.length === 0) return;
			this.scheduled = true;
			queueMicrotask(() => { this.scheduled = false; void this.flush().catch(error => this.destination.onError(error)); });
		});
	}

	public snapshot(): RendererProjectState {
		return { visualModules: this.manager.state.visualModules.value, timelineScenes: this.manager.state.timelineScenes.value };
	}

	public async flush(): Promise<void> {
		if (this.disposed || this.pending.size === 0) return this.inFlight;
		const targets = [...this.pending.values()];
		this.pending.clear();
		const scenes = new Set(targets.filter(target => target.type === 'scene').map(target => target.sceneId));
		// 追加・削除・置換されたレイヤーでは、内部Moduleもレイヤーの最終状態に含まれる。
		// 部分編集同士ならModuleの変更種別も残すため、個別通知を吸収しない。
		const layers = new Set(targets.flatMap(target => target.type === 'layer' && target.changes.some(change => change.type === 'definition') ? [JSON.stringify([target.sceneId, target.layerId])] : []));
		const modules = new Set(targets.filter(target => target.type === 'visualModule').map(target => visualModuleTargetKey(target.target)));
		const changes: RendererProjectChange[] = [];
		for (const target of targets) {
			if (target.type === 'node' || target.type === 'visualModule') {
				const moduleTarget = target.target;
				if (!('visualModuleId' in moduleTarget) && (scenes.has(moduleTarget.sceneId) || layers.has(JSON.stringify([moduleTarget.sceneId, moduleTarget.inlineVisualModuleLayerId])))) continue;
				if (target.type === 'node' && modules.has(visualModuleTargetKey(moduleTarget))) continue;
				const module = findVisualModule(this.manager.state, moduleTarget);
				if (!module) throw new Error('Changed visual module not found');
				// コマンドpayloadには新しい値等も含まれる。通信では所在を示すIDだけを使う。
				const address: VisualModuleTarget = 'visualModuleId' in moduleTarget ? { visualModuleId: moduleTarget.visualModuleId }
					: { sceneId: moduleTarget.sceneId, inlineVisualModuleLayerId: moduleTarget.inlineVisualModuleLayerId };
				if (target.type === 'visualModule') changes.push({ type: 'visualModule', target: address, visualModule: module });
				else {
					const node = module.nodes.find(node => node.id === target.nodeId);
					if (!node) throw new Error('Changed node not found');
					changes.push({ type: 'node', target: address, node, changes: target.changes });
				}
			} else {
				if (target.type !== 'scene' && scenes.has(target.sceneId)) continue;
				const scene = this.manager.state.timelineScenes.value.find(scene => scene.id === target.sceneId);
				if (target.type === 'scene') changes.push({ type: 'scene', sceneId: target.sceneId, scene: scene ?? null });
				else if (!scene) throw new Error('Changed scene not found');
				else if (target.type === 'layer') changes.push({ ...target, layer: scene.layers.find(layer => layer.id === target.layerId) ?? null });
				else changes.push({ ...target, layerIds: scene.layers.map(layer => layer.id) });
			}
		}
		// モジュール編集→引数更新→順序の順。追加・削除されたレイヤーも含む確定順序を最後に適用する。
		const rank = (change: RendererProjectChange) => change.type === 'layerOrder' ? 2 : change.type === 'layer' ? 1 : 0;
		changes.sort((a, b) => rank(a) - rank(b));
		const update = this.destination.apply(deepClone(changes)).catch(async error => {
			if (this.disposed) return;
			// RPCの適用失敗は最新の確定状態から復旧する。古い差分をリプレイしない。
			this.destination.onError(error);
			await this.destination.replace(deepClone(this.snapshot()));
		}).then(() => { if (!this.disposed) this.destination.onUpdated(); });
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
