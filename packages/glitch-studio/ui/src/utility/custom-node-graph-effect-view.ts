import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { computed, isReactive } from 'vue';
import type { ComputedRef } from 'vue';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { CustomNodeGraphEffect as Definition, CustomNodeGraphEffectNode as StoredNode, CustomNodeGraphEffectOutputSource, CustomNodeGraphEffectParameterBinding as StoredBinding } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { CustomNodeGraphEffectEditorMetadata } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectState } from '../Project.ts';
import { getEffectDefinitions } from './project-effects.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectNode, CustomNodeGraphEffectParameterBinding, CustomNodeGraphEffectParamDef, CustomNodeGraphEffectCustomParameterDefinition } from '../types/custom-node-graph-effect-view.ts';

type Connection = { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
const defaultSampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } as const;

function viewConnection(source: CustomNodeGraphEffectOutputSource | null | undefined, inputId: string): Connection {
	if (source == null) return { nodeId: null, outputPort: null };
	return 'parameterId' in source ? { nodeId: inputId, outputPort: source.parameterId } : { ...source };
}

function storedConnection(source: Connection, inputId: string): CustomNodeGraphEffectOutputSource | null {
	if (source.nodeId == null) return null;
	return source.nodeId === inputId ? { parameterId: source.outputPort } : { nodeId: source.nodeId, outputPort: source.outputPort };
}

/** 複合値の末端だけを変換する。色やベクトルのリテラルは配列入力と区別する。 */
function mapBinding<A extends StoredBinding | CustomNodeGraphEffectParameterBinding, B extends StoredBinding | CustomNodeGraphEffectParameterBinding>(
	def: ParameterDefinition, binding: A, leaf: (value: A) => B,
): B | Extract<StoredBinding, { inputSource: 'literal' }> {
	if (binding.inputSource === 'literal' && def.dataType.kind === 'array') {
		return { inputSource: 'literal', ...(binding.expressionModifier == null ? {} : { expressionModifier: binding.expressionModifier }), value: (binding.value as ParameterArrayElement<A>[]).map(element => ({ ...element,
			binding: mapBinding(getArrayElementDefinition(def), element.binding, leaf) })) };
	}
	if (binding.inputSource === 'literal' && def.dataType.kind === 'struct') {
		const fields = getStructFieldDefinitions(def);
		return { inputSource: 'literal', ...(binding.expressionModifier == null ? {} : { expressionModifier: binding.expressionModifier }), value: Object.fromEntries(Object.entries(binding.value as Record<string, A>).map(([key, child]) =>
			[key, mapBinding(fields[key], child, leaf)])) };
	}
	return leaf(binding);
}

function viewBinding(binding: StoredBinding, inputId: string, paramDefs: Definition['paramDefs']): CustomNodeGraphEffectParameterBinding {
	if (binding.inputSource === 'node') return { inputSource: 'node', ...binding.sampling, ...viewConnection(binding.source, inputId) };
	if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference' && (binding.sampling != null || paramDefs[binding.parameterId]?.canNode === true)) {
		return { inputSource: 'node', nodeId: inputId, outputPort: binding.parameterId, ...(binding.sampling ?? defaultSampling) };
	}
	return binding as CustomNodeGraphEffectParameterBinding;
}

function storedBinding(binding: CustomNodeGraphEffectParameterBinding, inputId: string): StoredBinding {
	if (binding.inputSource !== 'node') return binding;
	const source = storedConnection(binding, inputId);
	const sampling = 'fitMode' in binding ? { fitMode: binding.fitMode ?? defaultSampling.fitMode,
		wrapMode: binding.wrapMode ?? defaultSampling.wrapMode, filterMode: binding.filterMode ?? defaultSampling.filterMode } : defaultSampling;
	return source != null && 'parameterId' in source
		? { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: source.parameterId, sampling }
		: { inputSource: 'node', source, sampling };
}

function virtualId(graph: Definition, base: string): string {
	let id = base;
	while (graph.nodes.some(node => node.id === id)) id += '_';
	return id;
}

export function createCustomNodeGraphEffectView(graph: Definition, metadata: CustomNodeGraphEffectEditorMetadata, state: ProjectState): CustomNodeGraphEffect {
	const inputId = virtualId(graph, 'globalIn');
	const outputId = virtualId(graph, 'globalOut');
	const definitions = getEffectDefinitions(state);
	const nodes: CustomNodeGraphEffectNode[] = graph.nodes.map(node => {
		const info = metadata.nodeMetadata?.[node.id];
		if (node.type === 'relay') return { ...node, label: info?.displayName, pos: info?.position, input: viewConnection(node.input, inputId) };
		const def = definitions.describe(node.effectSource);
		const params = Object.fromEntries(Object.entries(def.paramDefs).map(([key, parameter]) =>
			[key, mapBinding(parameter, node.params[key] ?? createDefaultParameterBinding(parameter), binding => viewBinding(binding, inputId, graph.paramDefs))]));
		return { ...node, type: 'effect', params, staticSettings: { ...node.staticSettings }, displayName: info?.displayName ?? '', pos: info?.position,
			isBypass: node.isBypass ?? false, resolution: node.resolution == null ? { mode: 'auto', scale: 1 } : 'mode' in node.resolution ? node.resolution : { mode: 'customAbsolute', ...node.resolution } };
	});
	return {
		resolutionInputParameters: [...graph.resolutionInputParameters],
		nodes: [{ id: inputId, type: 'globalIn' }, ...nodes, { id: outputId, type: 'globalOut', inputs: Object.fromEntries(Object.entries(graph.outputSources).map(([id, source]) => [id, viewConnection(source, inputId)])) }],
		paramDefs: Object.entries(graph.paramDefs).map(([id, def]) => ({ ...def, id, nameForReference: def.nameForReference ?? id, canNode: def.canNode === true })) as CustomNodeGraphEffectParamDef[],
		outputDefs: Object.entries(graph.outputDefs).map(([id, def]) => ({ ...def, id, name: def.nameForReference ?? id, label: def.label ?? id })),
		customParameterDefs: Object.entries(graph.customParameterDefs ?? {}).map(([id, def]) => ({ ...def, id, canNode: false })) as CustomNodeGraphEffectCustomParameterDefinition[],
		customParameterValues: { ...graph.customParameterValues } as CustomNodeGraphEffect['customParameterValues'], automationGraphs: [...graph.automationGraphs ?? []],
		primaryInputId: graph.primaryInputParameter as CustomNodeGraphEffect['primaryInputId'], primaryOutputId: graph.primaryOutput,
		primaryAudioInputId: graph.primaryAudioInputParameter as CustomNodeGraphEffect['primaryAudioInputId'],
	};
}

type GraphOwner = CustomNodeGraphEffectEditorMetadata & ({ definition: Definition } | { customNodeGraphEffect: Definition });
const activeEdits = new WeakMap<GraphOwner, CustomNodeGraphEffect>();
const views = new WeakMap<GraphOwner, ComputedRef<CustomNodeGraphEffect>>();
export function getCustomNodeGraphEffectView(owner: GraphOwner, state: ProjectState) {
	const editing = activeEdits.get(owner);
	if (editing != null) return editing;
	if (!isReactive(owner)) return createCustomNodeGraphEffectView('definition' in owner ? owner.definition : owner.customNodeGraphEffect, owner, state);
	let view = views.get(owner);
	if (view == null) {
		view = computed(() => createCustomNodeGraphEffectView('definition' in owner ? owner.definition : owner.customNodeGraphEffect, owner, state));
		views.set(owner, view);
	}
	return view.value;
}

/** 一操作内のCommandが同じ表示モデルを変更し終えてから、編集結果を保存する。 */
export function editCustomNodeGraphEffectView(owner: GraphOwner, state: ProjectState, write: () => void, nodeId?: string, metadataOnly = false) {
	const view = getCustomNodeGraphEffectView(owner, state);
	activeEdits.set(owner, view);
	try {
		write();
		saveCustomNodeGraphEffectView(owner, state, view, nodeId, metadataOnly);
	} finally {
		activeEdits.delete(owner);
		views.delete(owner);
	}
}

/** UIで仮想表示するIn/Outは保存せず、公開入力参照とoutputSourcesへ戻す。部分変更は対象ノードだけを交換する。 */
export function saveCustomNodeGraphEffectView(owner: GraphOwner, state: ProjectState, view: CustomNodeGraphEffect, nodeId?: string, metadataOnly = false) {
	const graph = 'definition' in owner ? owner.definition : owner.customNodeGraphEffect;
	const inputId = view.nodes.find(node => node.type === 'globalIn')!.id;
	const definitions = getEffectDefinitions(state);
	const metadata = { ...owner.nodeMetadata };
	const storeMetadata = (node: Exclude<CustomNodeGraphEffectNode, { type: 'globalIn' | 'globalOut' }>) => {
		const displayName = node.type === 'relay' ? node.label : node.displayName;
		const info = { ...metadata[node.id] };
		if (displayName != null && displayName !== '') info.displayName = displayName; else delete info.displayName;
		if (node.pos != null) info.position = node.pos; else delete info.position;
		if (Object.keys(info).length > 0) metadata[node.id] = info; else delete metadata[node.id];
	};
	const storeNode = (node: Exclude<CustomNodeGraphEffectNode, { type: 'globalIn' | 'globalOut' }>, previous?: StoredNode): StoredNode => {
		storeMetadata(node);
		if (node.type === 'relay') return { type: 'relay', id: node.id, dataType: node.dataType, input: storedConnection(node.input, inputId) };
		const def = definitions.describe(node.effectSource);
		const original = previous?.type === 'relay' ? undefined : previous;
		return { ...original, id: node.id, effectSource: node.effectSource,
			params: Object.fromEntries(Object.entries(node.params).flatMap(([key, binding]) => {
				const value = mapBinding(def.paramDefs[key], binding, leaf => storedBinding(leaf, inputId));
				return original != null && !Object.hasOwn(original.params, key) && deepEqual(value, createDefaultParameterBinding(def.paramDefs[key])) ? [] : [[key, value]];
			})),
			...(original == null || original.type != null ? { type: 'effect' } : {}),
			...(original?.isBypass != null || node.isBypass ? { isBypass: node.isBypass } : {}),
			...(original?.staticSettings != null || Object.keys(node.staticSettings).length > 0 ? { staticSettings: node.staticSettings } : {}),
			...(original?.resolution != null || node.resolution.mode !== 'auto' || node.resolution.scale !== 1 ? { resolution: node.resolution } : {}),
		};
	};
	let definition: Definition;
	if (nodeId != null) {
		const node = view.nodes.find(node => node.id === nodeId);
		if (node == null || node.type === 'globalIn' || node.type === 'globalOut') throw new Error('Effect or Relay node not found');
		if (metadataOnly) storeMetadata(node);
		else {
			const previous = graph.nodes.find(candidate => candidate.id === nodeId)!;
			Object.assign(previous, storeNode(node, previous));
		}
		definition = graph;
	} else {
		const out = view.nodes.find(node => node.type === 'globalOut')!;
		const paramDefs = Object.fromEntries(view.paramDefs.map(({ id, ...def }) => {
			const previous = graph.paramDefs[id];
			if (previous != null && previous.canNode == null && def.canNode === false) Reflect.deleteProperty(def, 'canNode');
			if (previous?.nameForReference == null && def.nameForReference === id) Reflect.deleteProperty(def, 'nameForReference');
			return [id, def];
		}));
		const outputDefs = Object.fromEntries(view.outputDefs.map(({ id, name, ...def }) => {
			if (graph.outputDefs[id]?.label == null && def.label === id) Reflect.deleteProperty(def, 'label');
			return [id, { ...def, ...(graph.outputDefs[id]?.nameForReference == null && name === id ? {} : { nameForReference: name }) }];
		}));
		const outputSources = Object.fromEntries(Object.entries(out.inputs).flatMap(([id, source]) => {
			const value = storedConnection(source, inputId);
			return value == null || !Object.hasOwn(outputDefs, id) ? [] : [[id, value]];
		}));
		const previous = new Map(graph.nodes.map(node => [node.id, node]));
		const nodes = view.nodes.filter(node => node.type === 'effect' || node.type === 'relay').map(node => {
			const original = previous.get(node.id);
			const updated = storeNode(node, original);
			return original != null && deepEqual(original, updated) ? original : updated;
		});
		const ids = new Set(nodes.map(node => node.id));
		for (const key of Object.keys(metadata)) if (!ids.has(key)) delete metadata[key];
		definition = { ...graph, paramDefs, outputDefs, outputSources, nodes,
			primaryInputParameter: view.primaryInputId, primaryOutput: view.primaryOutputId,
			...(view.primaryAudioInputId == null && graph.primaryAudioInputParameter == null ? {} : { primaryAudioInputParameter: view.primaryAudioInputId }),
			resolutionInputParameters: view.resolutionInputParameters,
			...(graph.automationGraphs != null || view.automationGraphs.length > 0 ? { automationGraphs: view.automationGraphs } : {}),
			...(graph.customParameterValues != null || Object.keys(view.customParameterValues).length > 0 ? { customParameterValues: view.customParameterValues } : {}),
			...(graph.customParameterDefs != null || view.customParameterDefs.length > 0 ? { customParameterDefs: Object.fromEntries(view.customParameterDefs.map(({ id, ...def }) => [id, def])) } : {}),
		};
	}
	if (Object.keys(metadata).length === 0) delete owner.nodeMetadata;
	else if (!deepEqual(owner.nodeMetadata, metadata)) owner.nodeMetadata = metadata;
	if (definition !== graph) Object.assign(graph, definition);
	views.delete(owner);
}
