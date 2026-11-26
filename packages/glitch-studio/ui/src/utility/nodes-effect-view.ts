import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { computed, isReactive } from 'vue';
import type { ComputedRef } from 'vue';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { NodesEffect as Definition, NodesEffectNode as StoredNode, NodesEffectOutputSource, NodesEffectParameterBinding as StoredBinding } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { NodesEffectEditorMetadata } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectState } from '../Project.ts';
import { getEffectDefinitions } from './project-effects.ts';
import type { NodesEffect, NodesEffectNode, NodesEffectParameterBinding, NodesEffectParamDef, NodesEffectCustomParameterDefinition } from '../types/nodes-effect-view.ts';

type Connection = { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
const defaultSampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } as const;

function viewConnection(source: NodesEffectOutputSource | null | undefined, inputId: string): Connection {
	if (source == null) return { nodeId: null, outputPort: null };
	return 'parameterId' in source ? { nodeId: inputId, outputPort: source.parameterId } : { ...source };
}

function storedConnection(source: Connection, inputId: string): NodesEffectOutputSource | null {
	if (source.nodeId == null) return null;
	return source.nodeId === inputId ? { parameterId: source.outputPort } : { nodeId: source.nodeId, outputPort: source.outputPort };
}

/** 複合値の末端だけを変換する。色やベクトルのリテラルは配列入力と区別する。 */
function mapBinding<A extends StoredBinding | NodesEffectParameterBinding, B extends StoredBinding | NodesEffectParameterBinding>(
	def: ParameterDefinition, binding: A, leaf: (value: A) => B,
): B | Extract<StoredBinding, { inputSource: 'literal' }> {
	if (binding.inputSource === 'literal' && isParameterType(def, 'array')) {
		return { inputSource: 'literal', ...(binding.expressionModifier == null ? {} : { expressionModifier: binding.expressionModifier }), value: (binding.value as ParameterArrayElement<A>[]).map(element => ({ ...element,
			binding: mapBinding(getArrayElementDefinition(def), element.binding, leaf) })) };
	}
	if (binding.inputSource === 'literal' && isParameterType(def, 'struct')) {
		const fields = getStructFieldDefinitions(def);
		return { inputSource: 'literal', ...(binding.expressionModifier == null ? {} : { expressionModifier: binding.expressionModifier }), value: Object.fromEntries(Object.entries(binding.value as Record<string, A>).map(([key, child]) =>
			[key, mapBinding(fields[key], child, leaf)])) };
	}
	return leaf(binding);
}

function viewBinding(binding: StoredBinding, inputId: string, paramDefs: Definition['paramDefs']): NodesEffectParameterBinding {
	if (binding.inputSource === 'node') return { inputSource: 'node', ...binding.sampling, ...viewConnection(binding.source, inputId) };
	if (binding.inputSource === 'nodesEffectPublicParameterReference' && (binding.sampling != null || paramDefs[binding.parameterId]?.canNode === true)) {
		return { inputSource: 'node', nodeId: inputId, outputPort: binding.parameterId, ...(binding.sampling ?? defaultSampling) };
	}
	return binding as NodesEffectParameterBinding;
}

function storedBinding(binding: NodesEffectParameterBinding, inputId: string): StoredBinding {
	if (binding.inputSource !== 'node') return binding;
	const source = storedConnection(binding, inputId);
	const sampling = 'fitMode' in binding ? { fitMode: binding.fitMode ?? defaultSampling.fitMode,
		wrapMode: binding.wrapMode ?? defaultSampling.wrapMode, filterMode: binding.filterMode ?? defaultSampling.filterMode } : defaultSampling;
	return source != null && 'parameterId' in source
		? { inputSource: 'nodesEffectPublicParameterReference', parameterId: source.parameterId, sampling }
		: { inputSource: 'node', source, sampling };
}

function virtualId(nodesEffect: Definition, base: string): string {
	let id = base;
	while (nodesEffect.nodes.some(node => node.id === id)) id += '_';
	return id;
}

export function createNodesEffectView(nodesEffect: Definition, metadata: NodesEffectEditorMetadata, state: ProjectState): NodesEffect {
	const inputId = virtualId(nodesEffect, 'globalIn');
	const outputId = virtualId(nodesEffect, 'globalOut');
	const definitions = getEffectDefinitions(state);
	const nodes: NodesEffectNode[] = nodesEffect.nodes.map(node => {
		const info = metadata.nodeMetadata?.[node.id];
		if (node.type === 'relay') return { ...node, label: info?.displayName, pos: info?.position, input: viewConnection(node.input, inputId) };
		const def = definitions.describe(node.effectSource);
		const params = Object.fromEntries(Object.entries(def.paramDefs).map(([key, parameter]) =>
			[key, mapBinding(parameter, node.params[key] ?? createDefaultParameterBinding(parameter), binding => viewBinding(binding, inputId, nodesEffect.paramDefs))]));
		return { ...node, type: 'effect', params, staticSettings: { ...node.staticSettings }, displayName: info?.displayName ?? '', pos: info?.position,
			isBypass: node.isBypass ?? false, resolution: node.resolution == null ? { mode: 'auto', scale: 1 } : 'mode' in node.resolution ? node.resolution : { mode: 'customAbsolute', ...node.resolution } };
	});
	return {
		resolutionInputParameters: [...nodesEffect.resolutionInputParameters],
		nodes: [{ id: inputId, type: 'globalIn' }, ...nodes, { id: outputId, type: 'globalOut', inputs: Object.fromEntries(Object.entries(nodesEffect.outputSources).map(([id, source]) => [id, viewConnection(source, inputId)])) }],
		paramDefs: Object.entries(nodesEffect.paramDefs).map(([id, def]) => ({ ...def, id, nameForReference: def.nameForReference ?? id, canNode: def.canNode === true })) as NodesEffectParamDef[],
		outputDefs: Object.entries(nodesEffect.outputDefs).map(([id, def]) => ({ ...def, id, name: def.nameForReference ?? id, label: def.label ?? id })),
		customParameterDefs: Object.entries(nodesEffect.customParameterDefs ?? {}).map(([id, def]) => ({ ...def, id, canNode: false })) as NodesEffectCustomParameterDefinition[],
		customParameterValues: { ...nodesEffect.customParameterValues } as NodesEffect['customParameterValues'], functionCurves: [...nodesEffect.functionCurves ?? []],
		primaryInputId: nodesEffect.primaryInputParameter as NodesEffect['primaryInputId'], primaryOutputId: nodesEffect.primaryOutput,
		primaryAudioInputId: nodesEffect.primaryAudioInputParameter as NodesEffect['primaryAudioInputId'],
	};
}

type NodesEffectViewOwner = NodesEffectEditorMetadata & ({ definition: Definition } | { nodesEffect: Definition });
const activeEdits = new WeakMap<NodesEffectViewOwner, NodesEffect>();
const views = new WeakMap<NodesEffectViewOwner, ComputedRef<NodesEffect>>();
export function getNodesEffectView(owner: NodesEffectViewOwner, state: ProjectState) {
	const editing = activeEdits.get(owner);
	if (editing != null) return editing;
	if (!isReactive(owner)) return createNodesEffectView('definition' in owner ? owner.definition : owner.nodesEffect, owner, state);
	let view = views.get(owner);
	if (view == null) {
		view = computed(() => createNodesEffectView('definition' in owner ? owner.definition : owner.nodesEffect, owner, state));
		views.set(owner, view);
	}
	return view.value;
}

/** 一操作内のCommandが同じ表示モデルを変更し終えてから、編集結果を保存する。 */
export function editNodesEffectView(owner: NodesEffectViewOwner, state: ProjectState, write: () => void, nodeId?: string, metadataOnly = false) {
	const view = getNodesEffectView(owner, state);
	activeEdits.set(owner, view);
	try {
		write();
		saveNodesEffectView(owner, state, view, nodeId, metadataOnly);
	} finally {
		activeEdits.delete(owner);
		views.delete(owner);
	}
}

/** UIで仮想表示するIn/Outは保存せず、公開入力参照とoutputSourcesへ戻す。部分変更は対象ノードだけを交換する。 */
export function saveNodesEffectView(owner: NodesEffectViewOwner, state: ProjectState, view: NodesEffect, nodeId?: string, metadataOnly = false) {
	const nodesEffect = 'definition' in owner ? owner.definition : owner.nodesEffect;
	const inputId = view.nodes.find(node => node.type === 'globalIn')!.id;
	const definitions = getEffectDefinitions(state);
	const metadata = { ...owner.nodeMetadata };
	const storeMetadata = (node: Exclude<NodesEffectNode, { type: 'globalIn' | 'globalOut' }>) => {
		const displayName = node.type === 'relay' ? node.label : node.displayName;
		const info = { ...metadata[node.id] };
		if (displayName != null && displayName !== '') info.displayName = displayName; else delete info.displayName;
		if (node.pos != null) info.position = node.pos; else delete info.position;
		if (Object.keys(info).length > 0) metadata[node.id] = info; else delete metadata[node.id];
	};
	const storeNode = (node: Exclude<NodesEffectNode, { type: 'globalIn' | 'globalOut' }>, previous?: StoredNode): StoredNode => {
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
			const previous = nodesEffect.nodes.find(candidate => candidate.id === nodeId)!;
			Object.assign(previous, storeNode(node, previous));
		}
		definition = nodesEffect;
	} else {
		const out = view.nodes.find(node => node.type === 'globalOut')!;
		const paramDefs = Object.fromEntries(view.paramDefs.map(({ id, ...def }) => {
			const previous = nodesEffect.paramDefs[id];
			if (previous != null && previous.canNode == null && def.canNode === false) Reflect.deleteProperty(def, 'canNode');
			if (previous?.nameForReference == null && def.nameForReference === id) Reflect.deleteProperty(def, 'nameForReference');
			return [id, def];
		}));
		const outputDefs = Object.fromEntries(view.outputDefs.map(({ id, name, ...def }) => {
			if (nodesEffect.outputDefs[id]?.label == null && def.label === id) Reflect.deleteProperty(def, 'label');
			return [id, { ...def, ...(nodesEffect.outputDefs[id]?.nameForReference == null && name === id ? {} : { nameForReference: name }) }];
		}));
		const outputSources = Object.fromEntries(Object.entries(out.inputs).flatMap(([id, source]) => {
			const value = storedConnection(source, inputId);
			return value == null || !Object.hasOwn(outputDefs, id) ? [] : [[id, value]];
		}));
		const previous = new Map(nodesEffect.nodes.map(node => [node.id, node]));
		const nodes = view.nodes.filter(node => node.type === 'effect' || node.type === 'relay').map(node => {
			const original = previous.get(node.id);
			const updated = storeNode(node, original);
			return original != null && deepEqual(original, updated) ? original : updated;
		});
		const ids = new Set(nodes.map(node => node.id));
		for (const key of Object.keys(metadata)) if (!ids.has(key)) delete metadata[key];
		definition = { ...nodesEffect, paramDefs, outputDefs, outputSources, nodes,
			primaryInputParameter: view.primaryInputId, primaryOutput: view.primaryOutputId,
			...(view.primaryAudioInputId == null && nodesEffect.primaryAudioInputParameter == null ? {} : { primaryAudioInputParameter: view.primaryAudioInputId }),
			resolutionInputParameters: view.resolutionInputParameters,
			...(nodesEffect.functionCurves != null || view.functionCurves.length > 0 ? { functionCurves: view.functionCurves } : {}),
			...(nodesEffect.customParameterValues != null || Object.keys(view.customParameterValues).length > 0 ? { customParameterValues: view.customParameterValues } : {}),
			...(nodesEffect.customParameterDefs != null || view.customParameterDefs.length > 0 ? { customParameterDefs: Object.fromEntries(view.customParameterDefs.map(({ id, ...def }) => [id, def])) } : {}),
		};
	}
	if (Object.keys(metadata).length === 0) delete owner.nodeMetadata;
	else if (!deepEqual(owner.nodeMetadata, metadata)) owner.nodeMetadata = metadata;
	if (definition !== nodesEffect) Object.assign(nodesEffect, definition);
	views.delete(owner);
}
