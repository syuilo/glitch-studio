import { createProjectEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import type { StaticSettingDefinitions, StaticSettingValues } from '@gs/shared/static-setting.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { getTimelineLayerStaticSettings } from '@gs/subsystems_timeline_shared/layer-static-settings.ts';
import { matchesAssetReferenceMimeType } from '@gs/shared/data-type/asset-reference.ts';
import { computed, shallowRef } from 'vue';
import { inspectStaticParameter, staticParameterShape } from '@gs/shared/parameter/static-parameter.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import { findDependencyCycle } from '@gs/shared/utility/dependency-cycle.ts';
import { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';
import { resolveEffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { inspectTimelineLayer, timelineLayerStaticShape } from '@gs/subsystems_timeline_shared/static-validation.ts';
import { getTimelineLayerOutputDependencyGraph, validateTimelineLayerMaskReferences } from '@gs/subsystems_timeline_shared/layer-output.ts';
import type { TimelineImageInputReference } from '@gs/subsystems_timeline_shared/layer-output.ts';
import { validateSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { customNodeGraphEffectTargetKey } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { EffectDefinitions } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { CustomNodeGraphEffectArgumentBindings } from '@/types/custom-node-graph-effect-view.ts';
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
	private nodeValidationShapes = new Map<string, Map<string, string>>();
	private units = new Map<string, ValidationUnit>();
	private errors = new Map<string, RenderValidationDiagnostic>();
	private dependents = new Map<string, Set<string>>();
	private sceneEdges = new Map<string, Map<string, readonly string[]>>();
	private imageInputs = new Map<string, Map<string, TimelineImageInputReference[]>>();
	private locations = new Map<string, Map<string, LayerLocation>>();
	private assets = new Map<string, string>();
	private players = new Set<string>();
	private customNodeGraphEffectLivePreviewInputs: { customNodeGraphEffectId: string; bindings: CustomNodeGraphEffectArgumentBindings } | null = null;
	public readonly diagnostics = shallowRef<readonly RenderValidationDiagnostic[]>([]);
	public readonly errorMessage = computed(() => this.diagnostics.value[0]?.message ?? null);

	constructor(private state: ProjectState, private builtinDefinitions: NativeEffectDefinitions) {}

	private get definitions() { return createProjectEffectDefinitions({ customShaderEffects: this.state.customShaderEffects?.value ?? [], customNodeGraphEffects: this.state.customNodeGraphEffects.value }, this.builtinDefinitions); }

	public reset(): void {
		this.nodeValidationShapes.clear(); this.units.clear(); this.errors.clear(); this.dependents.clear();
		this.sceneEdges.clear(); this.imageInputs.clear(); this.locations.clear();
		this.customNodeGraphEffectLivePreviewInputs = null;
		this.assets = new Map(this.state.assets.value.map(asset => [asset.id, asset.fileDataType]));
		this.players = new Set(this.state.players.value.map(player => player.id));
		for (const customNodeGraphEffect of this.state.customNodeGraphEffects.value) this.replaceCustomNodeGraphEffect({ customNodeGraphEffectId: customNodeGraphEffect.id }, customNodeGraphEffect.definition);
		for (const scene of this.state.timelineScenes.value) this.replaceScene(scene);
		this.checkRegistrations(); this.checkSettings(); this.checkSceneGraph(); this.publish();
	}

	public update(changes: readonly AppStateChange[]): void {
		if (changes.some(change => change.type === 'customShaderEffect')) {
			const previewInputs = this.customNodeGraphEffectLivePreviewInputs;
			this.reset();
			if (previewInputs != null) this.setCustomNodeGraphEffectLivePreviewInputs(previewInputs.customNodeGraphEffectId, previewInputs.bindings);
			return;
		}
		// 削除・追加が同じCommandに含まれても、最終状態と最終参照先だけを検査する。
		for (const change of changes) {
			if (change.type === 'customNodeGraphEffectRegistration') {
				const customNodeGraphEffect = this.state.customNodeGraphEffects.value.find(customNodeGraphEffect => customNodeGraphEffect.id === change.customNodeGraphEffectId);
				this.replaceCustomNodeGraphEffect({ customNodeGraphEffectId: change.customNodeGraphEffectId }, customNodeGraphEffect?.definition);
				this.recheckDependents('customNodeGraphEffect:' + change.customNodeGraphEffectId);
				this.checkRegistrations();
			} else if (change.type === 'customNodeGraphEffect' || change.type === 'node') {
				if ('customNodeGraphEffectId' in change.target) {
					const id = change.target.customNodeGraphEffectId;
					const graph = this.state.customNodeGraphEffects.value.find(entry => entry.id === id)?.definition;
					if (change.type === 'node' && graph != null) {
						const node = graph.nodes.find(node => node.id === change.nodeId);
						const shape = node == null ? null : this.nodeShape(node);
						if (shape != null && this.nodeValidationShapes.get(customNodeGraphEffectTargetKey(change.target))?.get(change.nodeId) === shape) continue;
					}
					this.replaceCustomNodeGraphEffect(change.target, graph);
					this.recheckDependents('customNodeGraphEffect:' + id);
				} else this.checkLayer(change.target.sceneId, change.target.layerId, true, true);
			} else if (change.type === 'scene' || change.type === 'layerTree' || change.type === 'layerOrder') {
				const scene = this.state.timelineScenes.value.find(scene => scene.id === change.sceneId);
				if (scene) this.replaceScene(scene); else this.removeTimelineScene(change.sceneId);
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
		if (this.customNodeGraphEffectLivePreviewInputs && changes.some(change => change.type === 'customNodeGraphEffect' || change.type === 'customNodeGraphEffectRegistration')) {
			this.removeUnit('Effect Live Preview inputs');
			this.setCustomNodeGraphEffectLivePreviewInputs(this.customNodeGraphEffectLivePreviewInputs.customNodeGraphEffectId, this.customNodeGraphEffectLivePreviewInputs.bindings);
		}
		this.publish();
	}

	public setCustomNodeGraphEffectLivePreviewInputs(customNodeGraphEffectId: string | null, bindings: CustomNodeGraphEffectArgumentBindings = {}) {
		this.customNodeGraphEffectLivePreviewInputs = customNodeGraphEffectId == null ? null : { customNodeGraphEffectId, bindings };
		if (customNodeGraphEffectId == null) { this.removeUnit('Effect Live Preview inputs'); this.publish(); return; }
		const customNodeGraphEffect = this.state.customNodeGraphEffects.value.find(customNodeGraphEffect => customNodeGraphEffect.id === customNodeGraphEffectId);
		if (!customNodeGraphEffect) { this.removeUnit('Effect Live Preview inputs'); this.publish(); return; }
		const values = Object.entries(customNodeGraphEffect.definition.paramDefs).map(([id, def]) => [def, bindings[id] ?? def.defaultValue] as const);
		const dependencies = new Set<string>();
		this.check('Effect Live Preview inputs', [customNodeGraphEffectId, values.map(([def, value]) => staticParameterShape(def, value))], () => {
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
			if (key.includes('/layer:')) this.checkLayerOutputGraph(key.slice('scene:'.length, key.lastIndexOf('/layer:')));
		}
	}

	private asset(id: string, dependencies: Set<string>): string {
		dependencies.add('asset:' + id);
		const mimeType = this.assets.get(id);
		if (mimeType == null || mimeType.length === 0) throw new Error('Asset not found or incompatible: ' + id);
		return mimeType;
	}

	private value(definition: ParameterDefinition, binding: any, dependencies: Set<string>) {
		if (binding.inputSource !== 'literal' || binding.value == null) return;
		const kind = definition.dataType.kind;
		if (kind === 'audioSource') {
			validatePlayerAudioSourceSelection(binding.value);
			dependencies.add('player:' + binding.value.playerId);
			if (!this.players.has(binding.value.playerId)) throw new Error('Player not found: ' + binding.value.playerId);
		}
	}

	private staticSettings(definitions: StaticSettingDefinitions, values: StaticSettingValues, dependencies: Set<string>) {
		const resolvedValues = createStaticSettingValues(definitions, values);
		for (const [key, definition] of Object.entries(definitions)) {
			const value = resolvedValues[key];
			if (value == null) continue;
			if (definition.dataType.kind === 'assetReference') {
				const mimeType = this.asset(value as string, dependencies);
				if (!matchesAssetReferenceMimeType(definition.dataType, mimeType)) throw new Error('Incompatible Asset: ' + value);
			} else if (definition.dataType.kind === 'playerReference') {
				dependencies.add('player:' + value);
				if (!this.players.has(value as string)) throw new Error('Player not found: ' + value);
			}
		}
	}

	private nodeShape(node: CustomNodeGraphEffect['nodes'][number], definitions?: EffectDefinitions): string | null {
		if (node.type === 'relay') return JSON.stringify(node);
		try {
			const { paramDefs } = resolveEffectSource(node.effectSource, definitions ?? this.definitions).definition;
			const params = Object.entries(node.params).map(([id, binding]) => [id, staticParameterShape(paramDefs[id], binding)]);
			return JSON.stringify([node.effectSource, node.staticSettings, node.resolution, node.isBypass, params]);
		} catch { return null; }
	}

	private replaceCustomNodeGraphEffect(target: CustomNodeGraphEffectTarget, graph?: CustomNodeGraphEffect | null) {
		const key = customNodeGraphEffectTargetKey(target);
		this.removeUnit(key);
		this.nodeValidationShapes.delete(key);
		if (graph == null) return;
		const dependencies = new Set<string>();
		this.check(key, null, () => {
			const source: EffectSource = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph };
			const definitions = this.definitions;
			this.checkEffectResources(source, dependencies, definitions);
			validateEffectSource(source, definitions);
			this.nodeValidationShapes.set(key, new Map(graph.nodes.flatMap(node => {
				const shape = this.nodeShape(node, definitions);
				return shape == null ? [] : [[node.id, shape]];
			})));
		}, dependencies);
	}

	private checkEffectResources(source: EffectSource, dependencies: Set<string>, definitions = this.definitions, visited = new Set<CustomNodeGraphEffect>()) {
		if (source.type === 'customNodeGraphEffectReference') dependencies.add('customNodeGraphEffect:' + source.id);
		const effect = resolveEffectSource(source, definitions);
		if (effect.type !== 'customNodeGraphEffect' || visited.has(effect.definition)) return;
		const graph = effect.definition;
		visited.add(graph);
		for (const node of graph.nodes) {
			if (node.type === 'relay') continue;
			this.checkEffectResources(node.effectSource, dependencies, definitions, visited);
			const def = resolveEffectSource(node.effectSource, definitions).definition;
			this.staticSettings(def.staticSettingDefs ?? {}, node.staticSettings ?? {}, dependencies);
			for (const [key, parameter] of Object.entries(def.paramDefs)) {
				inspectStaticParameter(parameter, node.params[key] ?? parameter.defaultValue, (leaf, value) => this.value(leaf, value, dependencies));
			}
		}
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

	private removeTimelineScene(id: string) {
		for (const layerId of this.locations.get(id)?.keys() ?? []) {
			this.removeUnit('scene:' + id + '/layer:' + layerId);
			this.replaceCustomNodeGraphEffect({ sceneId: id, layerId: layerId });
		}
		this.locations.delete(id); this.sceneEdges.delete(id); this.removeUnit('scene:' + id);
		this.imageInputs.delete(id); this.removeUnit('scene:' + id + '/layer outputs');
	}

	private replaceScene(scene: TimelineScene) {
		this.removeTimelineScene(scene.id);
		const locations = new Map<string, LayerLocation>();
		let duplicate = false;
		const visit = (layers: TimelineLayer[], path: number[], insideGroup: boolean) => layers.forEach((layer, index) => {
			if (locations.has(layer.id)) duplicate = true;
			locations.set(layer.id, { path: [...path, index], insideGroup });
			if (isTimelineContainerLayer(layer)) visit(layer.layers, [...path, index], insideGroup || layer.layerType === 'group');
		});
		visit(scene.layers, [], false);
		this.locations.set(scene.id, locations); this.sceneEdges.set(scene.id, new Map());
		this.imageInputs.set(scene.id, new Map());
		this.check('scene:' + scene.id, [scene.resolution, duplicate], () => {
			validateSceneResolution(scene.resolution);
			if (duplicate) throw new Error('Duplicate layer ID');
		});
		for (const id of locations.keys()) {
			this.checkLayer(scene.id, id, false);
		}
		this.checkSceneGraph();
		this.checkLayerOutputGraph(scene.id);
	}

	private checkLayer(sceneId: string, id: string, graph = true, force = false) {
		const layer = this.layer(sceneId, id);
		if (!layer) return;
		const dependencies = new Set<string>();
		const getEffect = () => layer.layerType === 'effect' ? resolveEffectSource(layer.effectSource, this.definitions).definition : null;
		const edges = layer.layerType === 'scene' ? layer.clips.map(clip => clip.sceneId) : [];
		const previous = this.sceneEdges.get(sceneId)?.get(id);
		// Shapeの種類など、形の抽出自体が失敗する設定も診断として保持する。
		let shape: unknown;
		try { shape = timelineLayerStaticShape(layer, getEffect()); } catch { shape = layer; }
		const changed = this.check('scene:' + sceneId + '/layer:' + id, shape, () => {
			const inputs: TimelineImageInputReference[] = [];
			this.imageInputs.get(sceneId)?.set(id, inputs);
			if (layer.layerType === 'camera' && this.locations.get(sceneId)?.get(id)?.insideGroup) throw new Error('Camera is inside a Group');
			if (layer.layerType === 'effect') this.checkEffectResources(layer.effectSource, dependencies);
			for (const scene of edges) {
				dependencies.add('scene:' + scene);
				if (!this.locations.has(scene) && !this.state.timelineScenes.value.some(candidate => candidate.id === scene)) throw new Error('Scene not found: ' + scene);
			}
			if (layer.layerType === 'image' || layer.layerType === 'video' || layer.layerType === 'audio') for (const clip of layer.clips) this.asset(clip.assetId, dependencies);

			const settings = getTimelineLayerStaticSettings(layer, getEffect());
			this.staticSettings(settings.definitions, settings.values ?? {}, dependencies);
			inspectTimelineLayer(layer, this.definitions, (def, binding) => {
				this.value(def, binding, dependencies);
				const input = binding as { inputSource: string };
				if (input.inputSource === 'lowerLayerOutput' || input.inputSource === 'anotherLayerOutput') inputs.push(binding as TimelineImageInputReference);
			});
		}, dependencies, force);
		if (!changed) return;
		this.sceneEdges.get(sceneId)?.set(id, edges);
		if (graph && JSON.stringify(previous) !== JSON.stringify(edges)) this.checkSceneGraph();
		if (graph) this.checkLayerOutputGraph(sceneId);
	}

	private checkLayerOutputGraph(sceneId: string) {
		const scene = this.state.timelineScenes.value.find(scene => scene.id === sceneId);
		if (scene == null) return;
		const graph = getTimelineLayerOutputDependencyGraph(scene.layers, id => this.imageInputs.get(sceneId)?.get(id) ?? []);
		// 参照切れ・不正な参照も再検証するが、通常パラメータの値はshapeに含めない。
		const structure = (layers: readonly TimelineLayer[]): unknown[] => layers.map(layer => [layer.id, layer.layerType,
			'layerMask' in layer ? layer.layerMask?.sourceLayerId : null, isTimelineContainerLayer(layer) ? structure(layer.layers) : null]);
		this.check('scene:' + sceneId + '/layer outputs', [[...graph], structure(scene.layers)], () => {
			validateTimelineLayerMaskReferences(scene.layers);
			const cycle = findDependencyCycle(graph);
			if (cycle != null) throw new Error('Circular layer output reference: ' + cycle.join(' → '));
		});
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
		const ids = this.state.customNodeGraphEffects.value.map(customNodeGraphEffect => customNodeGraphEffect.id);
		this.check('Custom Node Graph Effect registrations', ids, () => {
			if (new Set(ids).size !== ids.length) throw new Error('Duplicate Custom Node Graph Effect ID');
		});
	}

	private checkSettings() {
		this.check('Project settings', [this.state.resolution.value, this.state.timelineFps.value, this.state.timelineMotionBlur.value], () => {
			if (![this.state.resolution.value.width, this.state.resolution.value.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid project resolution');
			validateTimelineFps(this.state.timelineFps.value); validateTimelineMotionBlur(this.state.timelineMotionBlur.value);
		});
	}
}
