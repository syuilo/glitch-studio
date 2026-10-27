import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { findTimelineLayerLocation } from './layer-tree.ts';
import { isTimelineContainerLayer, hasTimelineLayerParameters } from './types.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineLayer, TimelineLayerWithParameters } from './types.ts';

declare const timelineLayerCustomParameterIdentity: unique symbol;
export type TimelineLayerCustomParameterId = string & { readonly [timelineLayerCustomParameterIdentity]: 'id' };
export function timelineLayerCustomParameterId(value: string): TimelineLayerCustomParameterId {
	return value as TimelineLayerCustomParameterId;
}

export type TimelineLayerCustomParameterDataType = Extract<DataType, { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' }>;
export type TimelineLayerCustomParameterDefinition = ParameterDefinition<TimelineLayerCustomParameterDataType> & {
	id: TimelineLayerCustomParameterId;
	nameForReference: string;
};

export type TimelineLayerCustomParameterOwner = Pick<TimelineLayerWithParameters, 'id' | 'name' | 'automationGraphs' | 'customParameterDefs' | 'customParameterValues'>;

/** 祖先はフォルダを除き、Scene直下から親の順。Scene参照を跨ぐ環境は作らない。 */
export type TimelineLayerCustomParameterContext = {
	layer: TimelineLayerCustomParameterOwner;
	ancestors: readonly TimelineLayerCustomParameterOwner[];
};

function createTimelineLayerCustomParameterOwner(layer: TimelineLayerWithParameters): TimelineLayerCustomParameterOwner {
	return {
		id: layer.id,
		name: layer.name,
		automationGraphs: layer.automationGraphs,
		customParameterDefs: layer.customParameterDefs,
		customParameterValues: layer.customParameterValues,
	};
}

export function getTimelineLayerCustomParameterContext(layers: TimelineLayer[], layerId: string): TimelineLayerCustomParameterContext | null {
	const location = findTimelineLayerLocation(layers, layerId);
	return location == null || !hasTimelineLayerParameters(location.layer) ? null : {
		layer: createTimelineLayerCustomParameterOwner(location.layer),
		ancestors: location.ancestors.filter(hasTimelineLayerParameters).map(createTimelineLayerCustomParameterOwner),
	};
}

/** 同じSceneをまとめて評価するときは一度の走査で環境を作り、レイヤーごとの全木探索を避ける。 */
export function createTimelineLayerCustomParameterContextIndex(layers: readonly TimelineLayer[]): ReadonlyMap<string, TimelineLayerCustomParameterContext> {
	const contexts = new Map<string, TimelineLayerCustomParameterContext>();
	const visit = (layers: readonly TimelineLayer[], ancestors: readonly TimelineLayerCustomParameterOwner[]) => {
		for (const layer of layers) {
			// フォルダ挿入でPARAMの親が変わらないよう、階層だけを透過する。
			// 空のパラメータコンテナはここを通らず、明示的なスコープとして残す。
			if (layer.layerType === 'folder') { visit(layer.layers, ancestors); continue; }
			const owner = createTimelineLayerCustomParameterOwner(layer);
			contexts.set(layer.id, { layer: owner, ancestors });
			if (isTimelineContainerLayer(layer)) visit(layer.layers, [...ancestors, owner]);
		}
	};
	visit(layers, []);
	return contexts;
}

export function getTimelineLayerCustomParameterSources(context: TimelineLayerCustomParameterContext, isCustomParameterValue = false): TimelineLayerCustomParameterOwner[] {
	return [...isCustomParameterValue ? [] : [context.layer], ...context.ancestors.toReversed()];
}

export function resolveTimelineLayerCustomParameterReference(context: TimelineLayerCustomParameterContext, layerId: string | null, parameterId: TimelineLayerCustomParameterId | null, isCustomParameterValue = false) {
	const layer = getTimelineLayerCustomParameterSources(context, isCustomParameterValue).find(layer => layer.id === layerId);
	const definition = layer?.customParameterDefs?.find(definition => definition.id === parameterId);
	return layer == null || definition == null ? null : { layer, definition };
}

export function validateTimelineLayerCustomParameterDefinitions(definitions: readonly TimelineLayerCustomParameterDefinition[]): void {
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const definition of definitions) {
		if (!['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp'].includes(definition.dataType.kind)) throw new Error('Unsupported timeline custom parameter type');
		if (definition.id.length === 0 || ids.has(definition.id)) throw new Error('Duplicate or empty timeline custom parameter ID');
		if (definition.nameForReference.trim().length === 0 || names.has(definition.nameForReference)) throw new Error('Duplicate or empty timeline custom parameter reference name');
		if (definition.canNode === true) throw new Error('Timeline custom parameters cannot use node inputs');
		validateParameterDefaultValues(definition);
		if (isParameterType(definition, 'enum')) {
			const options = definition.dataType.options;
			if (options.length === 0 || options.some(option => option.trim().length === 0) || new Set(options).size !== options.length) throw new Error('Enum options must be non-empty and unique');
			if (!options.includes(definition.defaultValue.value)) throw new Error('Enum default must be one of its options');
		}
		ids.add(definition.id);
		names.add(definition.nameForReference);
	}
}

export function areTimelineCustomParameterTypesCompatible(target: Pick<ParameterDefinition, 'dataType'>, source: Pick<ParameterDefinition, 'dataType'>): boolean {
	return areDataTypesEqual(target.dataType, source.dataType);
}
