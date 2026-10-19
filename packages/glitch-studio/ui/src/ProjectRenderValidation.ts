import { LUT_ASSET_MIME_TYPE } from '@gs/shared/media/lut.ts';
import { computed, shallowRef } from 'vue';
import { inspectStaticParameter, staticParameterShape } from '@gs/shared/parameter/static-parameter.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import { findDependencyCycle } from '@gs/shared/utility/dependency-cycle.ts';
import { inspectVisualModuleNode, validateVisualModuleInterface, visualModuleNodeStaticShape } from '@gs/subsystems_visual-module_shared/static-validation.ts';
import { inspectTimelineLayer, timelineLayerStaticShape } from '@gs/subsystems_timeline_shared/static-validation.ts';
import { validateSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { visualModuleTargetKey } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule, VisualModuleNode, VisualModuleArgumentBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { AppStateChange, ProjectState } from './Project.ts';

export type RenderValidationDiagnostic = { target: string; message: string };
type ValidationUnit = { shape: string; dependencies: Set<string>; check: () => void };
type LayerLocation = { path: number[]; insideGroup: boolean };

/**
 * 正となる編集状態に対して同期的に検証する。レンダラーへ送信する前に結果を確定する。
 * 値の検証は評価側に残し、各単位の静的な形が同じなら検証器もグラフ走査も呼ばない。
 * 描画停止はプロジェクト全体なので、子の診断を参照元へ伝播・複製する必要はない。
 */
export class ProjectRenderValidation {
	private units = new Map<string, ValidationUnit>();
	private errors = new Map<string, RenderValidationDiagnostic>();
	private dependents = new Map<string, Set<string>>();
	private visualModules = new Map<string, VisualModule>();
	private nodeEdges = new Map<string, Map<string, readonly string[]>>();
	private sceneEdges = new Map<string, Map<string, readonly string[]>>();
	private locations = new Map<string, Map<string, LayerLocation>>();
	private assets = new Map<string, string>();
	private players = new Set<string>();
	private liveInputs: { visualModuleId: string; bindings: VisualModuleArgumentBindings } | null = null;
	public readonly diagnostics = shallowRef<readonly RenderValidationDiagnostic[]>([]);
	public readonly errorMessage = computed(() => this.diagnostics.value[0]?.message ?? null);

	constructor(private state: ProjectState, private definitions: Readonly<Record<string, EffectDefinition>>) {}

	public reset(): void {
		this.units.clear(); this.errors.clear(); this.dependents.clear();
		this.visualModules.clear(); this.nodeEdges.clear(); this.sceneEdges.clear(); this.locations.clear();
		this.liveInputs = null;
		this.assets = new Map(this.state.assets.value.map(asset => [asset.id, asset.fileDataType]));
		this.players = new Set(this.state.players.value.map(player => player.id));
		for (const visualModule of this.state.visualModules.value) this.replaceVisualModule({ visualModuleId: visualModule.id }, visualModule);
		for (const scene of this.state.timelineScenes.value) this.replaceScene(scene);
		this.checkRegistrations(); this.checkSettings(); this.checkSceneGraph(); this.publish();
	}

	public update(changes: readonly AppStateChange[]): void {
		// 削除・追加が同じCommandに含まれても、最終状態と最終参照先だけを検査する。
		for (const change of changes) {
			if (change.type === 'visualModuleRegistration') {
				const visualModule = this.state.visualModules.value.find(visualModule => visualModule.id === change.visualModuleId);
				this.replaceVisualModule({ visualModuleId: change.visualModuleId }, visualModule);
				this.recheckDependents('visualModule:' + change.visualModuleId);
				this.checkRegistrations();
			} else if (change.type === 'visualModule' || change.type === 'node') {
				const visualModule = this.resolveVisualModule(change.target);
				if (change.type === 'visualModule') {
					this.replaceVisualModule(change.target, visualModule);
					if ('visualModuleId' in change.target) this.recheckDependents('visualModule:' + change.target.visualModuleId);
					else {
						// 公開定義の型・canNodeの変更は、Bindingの形が同じでも引数の許可条件を変える。
						// Inlineの利用先は所有レイヤー一つなので、参照索引を経由せず再検証する。
						this.checkLayer(change.target.sceneId, change.target.inlineVisualModuleLayerId, false, true);
					}
				} else if (visualModule) {
					this.visualModules.set(visualModuleTargetKey(change.target), visualModule);
					const node = visualModule.nodes.find(node => node.id === change.nodeId);
					if (node) this.checkNode(change.target, node);
				}
			} else if (change.type === 'scene' || change.type === 'layerTree' || change.type === 'layerOrder') {
				const scene = this.state.timelineScenes.value.find(scene => scene.id === change.sceneId);
				if (scene) this.replaceScene(scene); else this.removeScene(change.sceneId);
				this.recheckDependents('scene:' + change.sceneId);
				this.checkSceneGraph();
			} else if (change.type === 'layer') {
				if (change.changes.some(edit => edit.type === 'definition')) {
					const scene = this.state.timelineScenes.value.find(scene => scene.id === change.sceneId);
					if (scene) this.replaceScene(scene);
				} else this.checkLayer(change.sceneId, change.layerId);
			} else if (change.type === 'asset') {
				const asset = this.state.assets.value.find(asset => asset.id === change.assetId);
				if (asset) this.assets.set(asset.id, asset.fileDataType); else this.assets.delete(change.assetId);
				this.recheckDependents('asset:' + change.assetId);
			} else if (change.type === 'player') {
				if (this.state.players.value.some(player => player.id === change.playerId)) this.players.add(change.playerId); else this.players.delete(change.playerId);
				this.recheckDependents('player:' + change.playerId);
			} else if (change.type === 'projectResolution' || change.type === 'timelineRenderSettings') this.checkSettings();
		}
		if (this.liveInputs && changes.some(change => change.type === 'visualModule' || change.type === 'visualModuleRegistration')) {
			this.removeUnit('Visual Module Live Preview inputs');
			this.setLiveInputs(this.liveInputs.visualModuleId, this.liveInputs.bindings);
		}
		this.publish();
	}

	public setLiveInputs(visualModuleId: string | null, bindings: VisualModuleArgumentBindings = {}) {
		this.liveInputs = visualModuleId == null ? null : { visualModuleId, bindings };
		if (visualModuleId == null) { this.removeUnit('Visual Module Live Preview inputs'); this.publish(); return; }
		const visualModule = this.state.visualModules.value.find(visualModule => visualModule.id === visualModuleId);
		if (!visualModule) { this.removeUnit('Visual Module Live Preview inputs'); this.publish(); return; }
		const values = visualModule.paramDefs.map(def => [def, bindings[def.id] ?? def.defaultValue] as const);
		const dependencies = new Set<string>();
		this.check('Visual Module Live Preview inputs', [visualModuleId, values.map(([def, value]) => staticParameterShape(def, value))], () => {
			for (const [def, value] of values) inspectStaticParameter(def, value, (leaf, binding) => {
				if (leaf.dataType.kind === 'audioSource') validateLiteralAudioSourceBinding(binding);
				this.value(leaf, binding, dependencies);
			});
		}, dependencies);
		this.publish();
	}

	private publish() {
		const next = [...this.errors.values()];
		if (JSON.stringify(next) !== JSON.stringify(this.diagnostics.value)) this.diagnostics.value = next;
	}

	private check(key: string, shape: unknown, check: () => void, dependencies = new Set<string>(), force = false): boolean {
		const serialized = JSON.stringify(shape);
		if (!force && this.units.get(key)?.shape === serialized) return false;
		this.removeUnit(key);
		this.units.set(key, { shape: serialized, dependencies, check });
		try { check(); } catch (error) { this.errors.set(key, { target: key, message: `${key}: ${error instanceof Error ? error.message : String(error)}` }); }
		for (const dependency of dependencies) {
			let users = this.dependents.get(dependency);
			if (!users) this.dependents.set(dependency, users = new Set());
			users.add(key);
		}
		return true;
	}

	private removeUnit(key: string) {
		for (const dependency of this.units.get(key)?.dependencies ?? []) {
			const users = this.dependents.get(dependency);
			users?.delete(key);
			if (users?.size === 0) this.dependents.delete(dependency);
		}
		this.units.delete(key); this.errors.delete(key);
	}

	private recheckDependents(reference: string) {
		for (const key of [...this.dependents.get(reference) ?? []]) {
			const unit = this.units.get(key)!;
			this.check(key, JSON.parse(unit.shape), unit.check, unit.dependencies, true);
			if (key.includes('/node:')) this.checkNodeGraph(key.slice(0, key.lastIndexOf('/node:')));
		}
	}

	private asset(id: string, dependencies: Set<string>, kind?: string | null) {
		dependencies.add('asset:' + id);
		const type = this.assets.get(id);
		if (!type || (kind && !type.startsWith(kind + '/'))) throw new Error('Asset not found or incompatible: ' + id);
	}

	private value(definition: ParameterDefinition, binding: any, dependencies: Set<string>) {
		if (binding.inputSource !== 'literal' || binding.value == null) return;
		const kind = definition.dataType.kind;
		if (kind === 'imageAssetTextureReference' || kind === 'videoAssetReference' || kind === 'fontAssetReference') this.asset(binding.value, dependencies, kind === 'videoAssetReference' ? 'video' : kind === 'fontAssetReference' ? 'font' : null);
		if (kind === 'lutAssetReference') {
			this.asset(binding.value, dependencies);
			if (this.assets.get(binding.value) !== LUT_ASSET_MIME_TYPE) throw new Error('Incompatible LUT Asset: ' + binding.value);
		}
		if (kind === 'playerReference' || kind === 'audioSource') {
			if (kind === 'audioSource') validatePlayerAudioSourceSelection(binding.value);
			const id = kind === 'audioSource' ? binding.value.playerId : binding.value;
			dependencies.add('player:' + id);
			if (!this.players.has(id)) throw new Error('Player not found: ' + id);
		}
	}

	private resolveVisualModule(target: VisualModuleTarget): VisualModule | null {
		if ('visualModuleId' in target) return this.state.visualModules.value.find(visualModule => visualModule.id === target.visualModuleId) ?? null;
		const layer = this.layer(target.sceneId, target.inlineVisualModuleLayerId);
		return layer?.layerType === 'inlineVisualModule' ? layer.visualModule : null;
	}

	private replaceVisualModule(target: VisualModuleTarget, visualModule?: VisualModule | null) {
		const key = visualModuleTargetKey(target);
		for (const nodeId of this.nodeEdges.get(key)?.keys() ?? []) this.removeUnit(key + '/node:' + nodeId);
		this.removeUnit(key); this.removeUnit(key + '/connections');
		this.nodeEdges.delete(key); this.visualModules.delete(key);
		if (!visualModule) return;
		this.visualModules.set(key, visualModule); this.nodeEdges.set(key, new Map());
		this.check(key, visualModule, () => validateVisualModuleInterface(visualModule));
		for (const node of visualModule.nodes) this.checkNode(target, node, false);
		this.checkNodeGraph(key);
	}

	private checkNode(target: VisualModuleTarget, node: VisualModuleNode, graph = true) {
		const key = visualModuleTargetKey(target);
		const edges: string[] = [];
		const dependencies = new Set<string>();
		let shape: unknown;
		try { shape = visualModuleNodeStaticShape(node, this.definitions); } catch { shape = node; }
		const changed = this.check(key + '/node:' + node.id, shape, () => {
			edges.length = 0;
			try {
				inspectVisualModuleNode(node, this.visualModules.get(key)!, this.definitions, id => edges.push(id), (def, binding) => this.value(def, binding, dependencies));
			} finally {
				this.nodeEdges.get(key)?.set(node.id, edges);
			}
		}, dependencies);
		if (!changed) return;
		if (graph) this.checkNodeGraph(key);
	}

	private checkNodeGraph(key: string) {
		const edges = this.nodeEdges.get(key)!;
		this.check(key + '/connections', [...edges], () => {
			const cycle = findDependencyCycle(edges);
			if (cycle) throw new Error('Circular node reference: ' + cycle.join(' → '));
		});
	}

	private layer(sceneId: string, layerId: string): TimelineLayer | null {
		const location = this.locations.get(sceneId)?.get(layerId);
		let layers = this.state.timelineScenes.value.find(scene => scene.id === sceneId)?.layers ?? null;
		let layer: TimelineLayer | null = null;
		for (const index of location?.path ?? []) {
			layer = layers?.[index] ?? null; layers = layer && isTimelineContainerLayer(layer) ? layer.layers : null;
		}
		return layer;
	}

	private removeScene(id: string) {
		for (const layerId of this.locations.get(id)?.keys() ?? []) {
			this.removeUnit('scene:' + id + '/layer:' + layerId);
			this.replaceVisualModule({ sceneId: id, inlineVisualModuleLayerId: layerId });
		}
		this.locations.delete(id); this.sceneEdges.delete(id); this.removeUnit('scene:' + id);
	}

	private replaceScene(scene: TimelineScene) {
		this.removeScene(scene.id);
		const locations = new Map<string, LayerLocation>();
		let duplicate = false;
		const visit = (layers: TimelineLayer[], path: number[], insideGroup: boolean) => layers.forEach((layer, index) => {
			if (locations.has(layer.id)) duplicate = true;
			locations.set(layer.id, { path: [...path, index], insideGroup });
			if (isTimelineContainerLayer(layer)) visit(layer.layers, [...path, index], insideGroup || layer.layerType === 'group');
		});
		visit(scene.layers, [], false);
		this.locations.set(scene.id, locations); this.sceneEdges.set(scene.id, new Map());
		this.check('scene:' + scene.id, [scene.resolution, duplicate], () => {
			validateSceneResolution(scene.resolution);
			if (duplicate) throw new Error('Duplicate layer ID');
		});
		for (const id of locations.keys()) {
			const layer = this.layer(scene.id, id)!;
			if (layer.layerType === 'inlineVisualModule') this.replaceVisualModule({ sceneId: scene.id, inlineVisualModuleLayerId: id }, layer.visualModule);
			this.checkLayer(scene.id, id, false);
		}
		this.checkSceneGraph();
	}

	private checkLayer(sceneId: string, id: string, graph = true, force = false) {
		const layer = this.layer(sceneId, id);
		if (!layer) return;
		const visualModule = layer.layerType === 'inlineVisualModule' ? layer.visualModule : layer.layerType === 'visualModule' ? this.state.visualModules.value.find(visualModule => visualModule.id === layer.visualModuleId) : null;
		const effect = layer.layerType === 'effect' ? this.definitions[layer.effectId] : null;
		const dependencies = new Set<string>();
		if (layer.layerType === 'visualModule') dependencies.add('visualModule:' + layer.visualModuleId);
		const edges = layer.layerType === 'scene' ? layer.clips.map(clip => clip.sceneId) : [];
		const previous = this.sceneEdges.get(sceneId)?.get(id);
		// Shapeの種類など、形の抽出自体が失敗する設定も診断として保持する。
		let shape: unknown;
		try { shape = timelineLayerStaticShape(layer, visualModule, effect); } catch { shape = layer; }
		const changed = this.check('scene:' + sceneId + '/layer:' + id, shape, () => {
			if (layer.layerType === 'camera' && this.locations.get(sceneId)?.get(id)?.insideGroup) throw new Error('Camera is inside a Group');
			if (layer.layerType === 'visualModule') dependencies.add('visualModule:' + layer.visualModuleId);
			for (const scene of edges) {
				dependencies.add('scene:' + scene);
				if (!this.locations.has(scene) && !this.state.timelineScenes.value.some(candidate => candidate.id === scene)) throw new Error('Scene not found: ' + scene);
			}
			if (layer.layerType === 'image' || layer.layerType === 'video' || layer.layerType === 'audio') for (const clip of layer.clips) this.asset(clip.assetId, dependencies);
			const currentVisualModule = layer.layerType === 'visualModule' ? this.state.visualModules.value.find(visualModule => visualModule.id === layer.visualModuleId) : visualModule;
			inspectTimelineLayer(layer, currentVisualModule, effect, (def, binding) => this.value(def, binding, dependencies));
		}, dependencies, force);
		if (!changed) return;
		this.sceneEdges.get(sceneId)?.set(id, edges);
		if (graph && JSON.stringify(previous) !== JSON.stringify(edges)) this.checkSceneGraph();
	}

	private checkSceneGraph() {
		const edges = new Map([...this.sceneEdges].map(([id, layers]) => [id, [...layers.values()].flat()]));
		this.check('Scene references', [this.state.timelineScenes.value.map(scene => scene.id), [...edges]], () => {
			if (new Set(this.state.timelineScenes.value.map(scene => scene.id)).size !== this.state.timelineScenes.value.length) throw new Error('Duplicate scene ID');
			const cycle = findDependencyCycle(edges);
			if (cycle) throw new Error('Circular scene reference: ' + cycle.join(' → '));
		});
	}

	private checkRegistrations() {
		const ids = this.state.visualModules.value.map(visualModule => visualModule.id);
		this.check('Visual Module registrations', ids, () => {
			if (new Set(ids).size !== ids.length) throw new Error('Duplicate Visual Module ID');
		});
	}

	private checkSettings() {
		this.check('Project settings', [this.state.resolution.value, this.state.timelineFps.value, this.state.timelineMotionBlur.value], () => {
			if (![this.state.resolution.value.width, this.state.resolution.value.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid project resolution');
			validateTimelineFps(this.state.timelineFps.value); validateTimelineMotionBlur(this.state.timelineMotionBlur.value);
		});
	}
}
