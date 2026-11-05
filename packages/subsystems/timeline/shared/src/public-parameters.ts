import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { findTimelineLayerLocation } from './layer-tree.ts';
import { isTimelineContainerLayer, hasTimelineLayerParameters } from './types.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineLayer, TimelineLayerWithParameters } from './types.ts';

declare const timelineLayerPublicParameterIdentity: unique symbol;
export type TimelineLayerPublicParameterId = string & { readonly [timelineLayerPublicParameterIdentity]: 'id' };
export function timelineLayerPublicParameterId(value: string): TimelineLayerPublicParameterId {
	return value as TimelineLayerPublicParameterId;
}

export type TimelineLayerPublicParameterDataType = Extract<DataType, { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' }>;
export type TimelineLayerPublicParameterDefinition = ParameterDefinition<TimelineLayerPublicParameterDataType> & {
	id: TimelineLayerPublicParameterId;
	nameForReference: string;
};

export type TimelineLayerPublicParameterOwner = Pick<TimelineLayerWithParameters, 'id' | 'name' | 'automationGraphs' | 'publicParameterDefs' | 'publicParameterValues'>;

/** 祖先はフォルダを除き、Scene直下から親の順。Scene参照を跨ぐ環境は作らない。 */
export type TimelineLayerPublicParameterContext = {
	layer: TimelineLayerPublicParameterOwner;
	ancestors: readonly TimelineLayerPublicParameterOwner[];
};

function createTimelineLayerPublicParameterOwner(layer: TimelineLayerWithParameters): TimelineLayerPublicParameterOwner {
	return {
		id: layer.id,
		name: layer.name,
		automationGraphs: layer.automationGraphs,
		publicParameterDefs: layer.publicParameterDefs,
		publicParameterValues: layer.publicParameterValues,
	};
}

export function getTimelineLayerPublicParameterContext(layers: TimelineLayer[], layerId: string): TimelineLayerPublicParameterContext | null {
	const location = findTimelineLayerLocation(layers, layerId);
	return location == null || !hasTimelineLayerParameters(location.layer) ? null : {
		layer: createTimelineLayerPublicParameterOwner(location.layer),
		ancestors: location.ancestors.filter(hasTimelineLayerParameters).map(createTimelineLayerPublicParameterOwner),
	};
}

/** 同じSceneをまとめて評価するときは一度の走査で環境を作り、レイヤーごとの全木探索を避ける。 */
export function createTimelineLayerPublicParameterContextIndex(layers: readonly TimelineLayer[]): ReadonlyMap<string, TimelineLayerPublicParameterContext> {
	const contexts = new Map<string, TimelineLayerPublicParameterContext>();
	const visit = (layers: readonly TimelineLayer[], ancestors: readonly TimelineLayerPublicParameterOwner[]) => {
		for (const layer of layers) {
			// フォルダ挿入でPUBLICの親が変わらないよう、階層だけを透過する。
			// 空のパラメータコンテナはここを通らず、明示的なスコープとして残す。
			if (layer.layerType === 'folder') { visit(layer.layers, ancestors); continue; }
			const owner = createTimelineLayerPublicParameterOwner(layer);
			contexts.set(layer.id, { layer: owner, ancestors });
			if (isTimelineContainerLayer(layer)) visit(layer.layers, [...ancestors, owner]);
		}
	};
	visit(layers, []);
	return contexts;
}

export function getTimelineLayerPublicParameterSources(context: TimelineLayerPublicParameterContext, isPublicParameterValue = false): TimelineLayerPublicParameterOwner[] {
	return [...isPublicParameterValue ? [] : [context.layer], ...context.ancestors.toReversed()];
}

export function resolveTimelineLayerPublicParameterReference(context: TimelineLayerPublicParameterContext, layerId: string | null, parameterId: TimelineLayerPublicParameterId | null, isPublicParameterValue = false) {
	const layer = getTimelineLayerPublicParameterSources(context, isPublicParameterValue).find(layer => layer.id === layerId);
	const definition = layer?.publicParameterDefs?.find(definition => definition.id === parameterId);
	return layer == null || definition == null ? null : { layer, definition };
}

export function validateTimelineLayerPublicParameterDefinitions(definitions: readonly TimelineLayerPublicParameterDefinition[]): void {
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const definition of definitions) {
		if (!['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference'].includes(definition.dataType.kind)) throw new Error('Unsupported timeline public parameter type');
		if (definition.id.length === 0 || ids.has(definition.id)) throw new Error('Duplicate or empty timeline public parameter ID');
		if (definition.nameForReference.trim().length === 0 || names.has(definition.nameForReference)) throw new Error('Duplicate or empty timeline public parameter reference name');
		if (definition.canNode === true) throw new Error('Timeline public parameters cannot use node inputs');
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

export function areTimelinePublicParameterTypesCompatible(target: Pick<ParameterDefinition, 'dataType'>, source: Pick<ParameterDefinition, 'dataType'>): boolean {
	return areDataTypesEqual(target.dataType, source.dataType);
}
