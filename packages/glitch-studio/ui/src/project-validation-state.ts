import { ValidationDiagnostics, inspectReferenceGraph } from '@gs/shared/validation/diagnostic.ts';
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';
import { inspectParameterTree, inspectValueBinding } from '@gs/shared/parameter/static-parameter-validation.ts';
import { inspectVisualModuleContract, inspectVisualModuleNode } from '@gs/subsystems_visual-module_shared/static-validation.ts';
import { inspectTimelineLayer, inspectTimelineSceneSettings } from '@gs/subsystems_timeline_shared/static-validation.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { findRendererVisualModule } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { visualModuleTargetKey } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { RendererProjectState, RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { VisualModule, VisualModuleNode, VisualModuleArgumentBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineScene, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { Asset } from '@gs/shared/types.ts';
import { inspectPlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';

type VisualModuleValidationRecord = { visualModule: VisualModule; nodes: Map<string, VisualModuleNode>; references: Map<string, readonly string[]> };
type LayerValidationRecord = { sceneId: string; layer: TimelineLayer; visualModuleId?: string; assetIds: Set<string> };

/**
 * UIで設定の診断を所有し、実行インスタンスを所有しない。
 * 値編集では一つの検証単位だけを置換する。参照索引は公開契約・Assetの変更に
 * 必要なものだけを持ち、診断を親Sceneへ複製・伝播しない。
 */
export class ProjectValidationState {
	public readonly diagnostics = new ValidationDiagnostics();
	public revision = 0;
	private readonly owners = new Map<string, Set<string>>();
	private readonly visualModules = new Map<string, VisualModuleValidationRecord>();
	private readonly registeredVisualModules = new Map<string, VisualModule>();
	private readonly layers = new Map<string, LayerValidationRecord>();
	private readonly sceneLayers = new Map<string, Set<string>>();
	private readonly sceneReferences = new Map<string, Map<string, readonly string[]>>();
	private readonly visualModuleUsers = new Map<string, Set<string>>();
	private readonly assetUsers = new Map<string, Set<string>>();
	private assets = new Set<string>();
	private readonly sceneResolutions = new Map<string, TimelineScene['resolution']>();
	private resolutionScale = 1;
	private maxDimension = Infinity;

	constructor(private readonly effectDefinitions: Readonly<Record<string, EffectDefinition>>) {}
	get valid() { return this.diagnostics.errorCount === 0; }

	private set(owner: string, unit: string, diagnostics: readonly ValidationDiagnostic[]) {
		const key = JSON.stringify([owner, unit]);
		let keys = this.owners.get(owner);
		if (!keys) this.owners.set(owner, keys = new Set());
		keys.add(key);
		this.diagnostics.set(key, diagnostics);
	}
	private remove(owner: string) {
		for (const key of this.owners.get(owner) ?? []) this.diagnostics.set(key, []);
		this.owners.delete(owner);
	}
	private visualModuleOwner(key: string) { return `visualModule:${key}`; }
	private layerKey(sceneId: string, layerId: string) { return JSON.stringify([sceneId, layerId]); }
	private inlineTarget(sceneId: string, layerId: string): VisualModuleTarget { return { sceneId, inlineVisualModuleLayerId: layerId }; }

	replace(state: RendererProjectState) {
		this.diagnostics.clear();
		this.owners.clear();
		this.visualModules.clear();
		this.registeredVisualModules.clear();
		this.layers.clear();
		this.sceneLayers.clear();
		this.sceneReferences.clear();
		this.visualModuleUsers.clear();
		this.assetUsers.clear();
		this.sceneResolutions.clear();
		for (const visualModule of state.visualModules) this.registeredVisualModules.set(visualModule.id, visualModule);
		this.set('project', 'visualModuleIds', this.registeredVisualModules.size === state.visualModules.length ? [] : [{ code: 'visualModule.id', message: 'Duplicate Visual Module ID' }]);
		for (const visualModule of state.visualModules) this.replaceVisualModule(visualModuleTargetKey({ visualModuleId: visualModule.id }), visualModule);
		for (const scene of state.timelineScenes) this.replaceScene(scene);
		this.set('project', 'sceneIds', this.sceneLayers.size === state.timelineScenes.length ? [] : [{ code: 'scene.id', message: 'Duplicate scene ID' }]);
		this.inspectSceneGraph();
		this.revision++;
	}

	private replaceVisualModule(key: string, visualModule: VisualModule) {
		const owner = this.visualModuleOwner(key);
		this.remove(owner);
		const record = { visualModule, nodes: new Map(visualModule.nodes.map(node => [node.id, node])), references: new Map<string, readonly string[]>() };
		this.visualModules.set(key, record);
		this.set(owner, 'contract', inspectVisualModuleContract(visualModule));
		this.set(owner, 'ids', record.nodes.size === visualModule.nodes.length ? [] : [{ code: 'node.id', message: 'Duplicate node ID' }]);
		for (const node of visualModule.nodes) this.inspectNode(key, record, node);
		this.set(owner, 'graph', inspectReferenceGraph(record.references));
	}

	private inspectNode(key: string, record: VisualModuleValidationRecord, node: VisualModuleNode): boolean {
		const result = inspectVisualModuleNode(node, record.visualModule, this.effectDefinitions, inspectPlayerAudioSourceSelection);
		const previous = record.references.get(node.id);
		record.nodes.set(node.id, node);
		record.references.set(node.id, result.references);
		this.set(this.visualModuleOwner(key), `node:${node.id}`, result.diagnostics);
		this.inspectNodeResolution(key, node);
		return !previous || JSON.stringify(previous) !== JSON.stringify(result.references);
	}

	private addUser(index: Map<string, Set<string>>, id: string, key: string) {
		let users = index.get(id);
		if (!users) index.set(id, users = new Set());
		users.add(key);
	}

	private removeLayer(key: string, removeVisualModule = true) {
		const previous = this.layers.get(key);
		if (!previous) return;
		if (previous.visualModuleId) this.visualModuleUsers.get(previous.visualModuleId)?.delete(key);
		for (const id of previous.assetIds) this.assetUsers.get(id)?.delete(key);
		if (removeVisualModule && previous.layer.layerType === 'inlineVisualModule') {
			const visualModuleKey = visualModuleTargetKey(this.inlineTarget(previous.sceneId, previous.layer.id));
			this.remove(this.visualModuleOwner(visualModuleKey)); this.visualModules.delete(visualModuleKey);
		}
		this.remove(`layer:${key}`); this.layers.delete(key);
		this.sceneReferences.get(previous.sceneId)?.delete(previous.layer.id);
	}

	private inspectLayerResolution(key: string, record: LayerValidationRecord) {
		const resolution = record.layer.layerType === 'effect' ? record.layer.resolution : undefined;
		this.set(`layer:${key}`, 'resolution', resolution?.mode === 'customAbsolute' && (resolution.width * this.resolutionScale > this.maxDimension || resolution.height * this.resolutionScale > this.maxDimension)
			? [{ code: 'resolution.limit', message: `Effect layer resolution exceeds ${this.maxDimension}` }] : []);
	}

	private inspectLayer(key: string, record: LayerValidationRecord) {
		const diagnostics = inspectTimelineLayer(record.layer, this.effectDefinitions, id => this.registeredVisualModules.get(id));
		for (const id of record.assetIds) if (!this.assets.has(id)) diagnostics.push({ code: 'asset.missing', message: `Asset not found: ${id}` });
		this.set(`layer:${key}`, 'settings', diagnostics);
		this.inspectLayerResolution(key, record);
	}

	private updateLayer(sceneId: string, layer: TimelineLayer, preserveInlineVisualModule = false): boolean {
		const key = this.layerKey(sceneId, layer.id);
		const previousReferences = this.sceneReferences.get(sceneId)?.get(layer.id) ?? [];
		this.removeLayer(key, !preserveInlineVisualModule);
		const assetIds = new Set<string>();
		if (layer.layerType === 'image' || layer.layerType === 'video' || layer.layerType === 'audio') for (const clip of layer.clips) assetIds.add(clip.assetId);
		const visualModuleId = layer.layerType === 'visualModule' ? layer.visualModuleId : undefined;
		const record = { sceneId, layer, visualModuleId, assetIds };
		this.layers.set(key, record);
		if (visualModuleId) this.addUser(this.visualModuleUsers, visualModuleId, key);
		for (const id of assetIds) this.addUser(this.assetUsers, id, key);
		if (layer.layerType === 'inlineVisualModule' && !preserveInlineVisualModule) this.replaceVisualModule(visualModuleTargetKey(this.inlineTarget(sceneId, layer.id)), layer.visualModule);
		this.inspectLayer(key, record);
		const references = layer.layerType === 'scene' ? [...new Set(layer.clips.map(clip => clip.sceneId))].sort() : [];
		this.sceneReferences.get(sceneId)!.set(layer.id, references);
		return JSON.stringify(previousReferences) !== JSON.stringify(references);
	}

	private removeScene(id: string) {
		for (const key of this.sceneLayers.get(id) ?? []) this.removeLayer(key);
		this.sceneLayers.delete(id); this.sceneReferences.delete(id); this.remove(`scene:${id}`);
		this.sceneResolutions.delete(id);
	}

	private replaceScene(scene: TimelineScene) {
		this.removeScene(scene.id);
		const keys = new Set<string>();
		this.sceneLayers.set(scene.id, keys); this.sceneReferences.set(scene.id, new Map());
		this.sceneResolutions.set(scene.id, scene.resolution);
		const diagnostics = inspectTimelineSceneSettings(scene);
		const visit = (layers: readonly TimelineLayer[], insideGroup: boolean) => {
			for (const layer of layers) {
				const key = this.layerKey(scene.id, layer.id);
				if (keys.has(key)) diagnostics.push({ code: 'layer.id', message: `Duplicate layer ID in scene: ${scene.name}` });
				keys.add(key);
				if (insideGroup && layer.layerType === 'camera') diagnostics.push({ code: 'camera.placement', message: `Camera "${layer.name}" is inside a Group` });
				this.updateLayer(scene.id, layer);
				if (isTimelineContainerLayer(layer)) visit(layer.layers, insideGroup || layer.layerType === 'group');
			}
		};
		visit(scene.layers, false);
		this.set(`scene:${scene.id}`, 'structure', diagnostics);
		this.inspectSceneResolution(scene.id, scene.resolution);
	}

	private inspectSceneGraph() {
		const graph = new Map([...this.sceneReferences].map(([id, layers]) => [id, [...new Set([...layers.values()].flat())]]));
		this.set('project', 'sceneGraph', inspectReferenceGraph(graph));
	}

	/** バッチの最終状態を使う。同じ単位への中間差分を何度も検証しない。 */
	apply(state: RendererProjectState, changes: readonly RendererProjectChange[]) {
		const finalNodes = new Map(changes.filter(change => change.type === 'node').map(change => [`${visualModuleTargetKey(change.target)}:${change.node.id}`, change.node]));
		const updated = new Set<string>();
		let sceneGraphChanged = false;
		const replacedScenes = new Set(changes.filter(change => change.type === 'scene' || change.type === 'layerTree').map(change => change.sceneId));
		const replacedVisualModules = new Set(changes.filter(change => change.type === 'visualModule' || change.type === 'visualModuleRegistration').map(change => change.type === 'visualModuleRegistration' ? visualModuleTargetKey({ visualModuleId: change.visualModuleId }) : visualModuleTargetKey(change.target)));
		for (const change of changes) {
			if (change.type === 'visualModuleRegistration' || change.type === 'visualModule' || change.type === 'node') {
				const target: VisualModuleTarget = change.type === 'visualModuleRegistration' ? { visualModuleId: change.visualModuleId } : change.target;
				if ('sceneId' in target && replacedScenes.has(target.sceneId)) continue;
				const key = visualModuleTargetKey(target);
				if (change.type === 'node' && replacedVisualModules.has(key)) continue;
				const unit = change.type === 'node' ? `${key}:${change.node.id}` : key;
				if (updated.has(unit)) continue;
				updated.add(unit);
				const visualModule = findRendererVisualModule(state, target);
				if ('visualModuleId' in target) {
					if (visualModule) this.registeredVisualModules.set(target.visualModuleId, visualModule);
					else this.registeredVisualModules.delete(target.visualModuleId);
				}
				if (!visualModule) {
					this.remove(this.visualModuleOwner(key));
					this.visualModules.delete(key);
				} else if (change.type !== 'node' || !this.visualModules.has(key)) {
					this.replaceVisualModule(key, visualModule);
				} else {
					const record = this.visualModules.get(key)!;
					record.visualModule = visualModule;
					const node = finalNodes.get(unit)!;
					if (this.inspectNode(key, record, node)) this.set(this.visualModuleOwner(key), 'graph', inspectReferenceGraph(record.references));
				}
				// 公開契約の変更だけが呼び出し側の引数検証を無効化する。内部ノードの値変更では不要。
				if (change.type !== 'node') {
					if ('visualModuleId' in target) for (const user of this.visualModuleUsers.get(target.visualModuleId) ?? []) this.inspectLayer(user, this.layers.get(user)!);
					else {
						const user = this.layerKey(target.sceneId, target.inlineVisualModuleLayerId);
						const record = this.layers.get(user);
						const scene = state.timelineScenes.find(scene => scene.id === target.sceneId);
						const layer = scene && findTimelineLayer(scene.layers, target.inlineVisualModuleLayerId);
						if (record && layer) { record.layer = layer; this.inspectLayer(user, record); }
					}
				}
			} else if (change.type === 'scene' || change.type === 'layerTree') {
				if (updated.has(`scene:${change.sceneId}`)) continue;
				updated.add(`scene:${change.sceneId}`);
				const scene = state.timelineScenes.find(scene => scene.id === change.sceneId);
				if (scene) this.replaceScene(scene); else this.removeScene(change.sceneId);
				sceneGraphChanged = true;
			} else if (change.type === 'layer' && !replacedScenes.has(change.sceneId)) {
				const key = this.layerKey(change.sceneId, change.layerId);
				if (updated.has(`layer:${key}`)) continue;
				updated.add(`layer:${key}`);
				const scene = state.timelineScenes.find(scene => scene.id === change.sceneId);
				const layer = scene && findTimelineLayer(scene.layers, change.layerId);
				// 種類変更・追加・削除は階層制約にも関わるためSceneの構造を検証する。
				if (!layer || !this.layers.has(key) || this.layers.get(key)!.layer.layerType !== layer.layerType) {
					if (scene) this.replaceScene(scene);
					sceneGraphChanged = true;
				} else sceneGraphChanged = this.updateLayer(change.sceneId, layer, !change.changes.some(edit => edit.type === 'definition')) || sceneGraphChanged;
			}
		}
		if (sceneGraphChanged) {
			this.inspectSceneGraph();
			this.set('project', 'sceneIds', this.sceneLayers.size === state.timelineScenes.length ? [] : [{ code: 'scene.id', message: 'Duplicate scene ID' }]);
		}
		if (changes.some(change => change.type === 'visualModuleRegistration')) this.set('project', 'visualModuleIds', this.registeredVisualModules.size === state.visualModules.length ? [] : [{ code: 'visualModule.id', message: 'Duplicate Visual Module ID' }]);
		this.revision++;
	}

	updateAssets(assets: readonly Asset[]) {
		const next = new Set(assets.map(asset => asset.id));
		const affected = new Set<string>();
		for (const id of new Set([...this.assets, ...next])) if (this.assets.has(id) !== next.has(id)) for (const user of this.assetUsers.get(id) ?? []) affected.add(user);
		this.assets = next;
		for (const user of affected) this.inspectLayer(user, this.layers.get(user)!);
		this.revision++;
	}

	private inspectNodeResolution(key: string, node: VisualModuleNode) {
		const resolution = node.type === 'effect' ? node.resolution : undefined;
		this.set(this.visualModuleOwner(key), `resolution:${node.id}`, resolution?.mode === 'customAbsolute' && (resolution.width * this.resolutionScale > this.maxDimension || resolution.height * this.resolutionScale > this.maxDimension)
			? [{ code: 'resolution.limit', message: `Node resolution exceeds ${this.maxDimension}`, path: [node.id] }] : []);
	}

	private inspectSceneResolution(id: string, resolution: TimelineScene['resolution']) {
		this.set(`scene:${id}`, 'resolution', resolution?.mode === 'customAbsolute' && (resolution.width * this.resolutionScale > this.maxDimension || resolution.height * this.resolutionScale > this.maxDimension)
			? [{ code: 'resolution.limit', message: `Scene resolution exceeds ${this.maxDimension}` }] : []);
	}

	setOptions(diagnostics: readonly ValidationDiagnostic[], resolutionScale = this.resolutionScale, maxDimension = this.maxDimension) {
		if (resolutionScale !== this.resolutionScale || maxDimension !== this.maxDimension) {
			this.resolutionScale = resolutionScale;
			this.maxDimension = maxDimension;
			// 環境変更では寸法設定だけを再検証する。パラメータやグラフには触れない。
			for (const [key, record] of this.visualModules) for (const node of record.nodes.values()) this.inspectNodeResolution(key, node);
			for (const [key, record] of this.layers) this.inspectLayerResolution(key, record);
			for (const [id, resolution] of this.sceneResolutions) this.inspectSceneResolution(id, resolution);
		}
		this.set('options', 'settings', diagnostics); this.revision++;
	}

	updateLiveArguments(visualModuleId: string | null, values: VisualModuleArgumentBindings) {
		const visualModule = visualModuleId == null ? undefined : this.registeredVisualModules.get(visualModuleId);
		const diagnostics: ValidationDiagnostic[] = [];
		for (const def of visualModule?.paramDefs ?? []) diagnostics.push(...inspectParameterTree(def, values[def.id] ?? def.defaultValue, (leaf, binding, path) => {
			if (leaf.dataType.kind !== 'audioSource') return inspectValueBinding(leaf, binding, path);
			const selection = binding.value;
			return binding.inputSource === 'literal' ? inspectPlayerAudioSourceSelection(selection).map(diagnostic => ({ ...diagnostic, path })) : [{ code: 'audio.selection', message: 'Audio sources must use a static Player input', path }];
		}, [def.id]));
		this.set('live', 'arguments', diagnostics); this.revision++;
	}
}
