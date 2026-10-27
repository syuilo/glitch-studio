import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { createTimelineTransformParameterValues } from './layers/transform/transform.ts';
import { timelineCompositingParamDefs } from './timeline-compositing.ts';
import { timelineAudioParamDefs } from './timeline-audio.ts';
import { hasTimelineLayerParameters } from './types.ts';
import type { TimelineContainerLayer, TimelineGroupLayer } from './types.ts';

export type TimelineContainerLayerType = TimelineContainerLayer['layerType'];
type ContainerOf<Type extends TimelineContainerLayerType> = Extract<TimelineContainerLayer, { layerType: Type }>;

/** 新規作成と変換で同じ既定値を使い、変換経路によって設定が変わることを防ぐ。 */
export function createTimelineContainerLayer<Type extends TimelineContainerLayerType>(type: Type, id: string, name: string): ContainerOf<Type> {
	const identity = { id, name, color: null, isDisabled: false, layers: [] };
	let layer: TimelineContainerLayer;
	switch (type) {
		case 'folder': layer = { ...identity, layerType: 'folder' }; break;
		case 'parameterContainer': layer = { ...identity, layerType: 'parameterContainer', automationGraphs: [] }; break;
		case 'transform': layer = { ...identity, layerType: 'transform', automationGraphs: [], forceDisableMotionBlur: false, transformParamValues: createTimelineTransformParameterValues() }; break;
		case 'group': layer = {
			...identity,
			layerType: 'group',
			automationGraphs: [],
			forceDisableMotionBlur: false,
			compositingMode: 'flat',
			coordinateSpace: 'screen',
			mask: null,
			layerMask: null,
			isIncludedInComposite: true,
			compositingParamValues: Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, definition]) => [key, deepClone(definition.defaultValue)])) as TimelineGroupLayer['compositingParamValues'],
			audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) },
		}; break;
		default: throw new Error('Unknown timeline container type');
	}
	return layer as ContainerOf<Type>;
}

export function getTimelineContainerConversionTargets(layer: TimelineContainerLayer): readonly TimelineContainerLayerType[] {
	switch (layer.layerType) {
		case 'folder': return ['parameterContainer', 'transform', 'group'];
		case 'parameterContainer': return ['transform', 'group'];
		case 'transform': return ['group'];
		case 'group': return [];
	}
}

/** 既存の値を捨てない方向だけ許可する。子と参照IDを維持し、式本文や参照先は自動変更しない。 */
export function convertTimelineContainerLayer(layer: TimelineContainerLayer, target: TimelineContainerLayerType): TimelineContainerLayer {
	if (!getTimelineContainerConversionTargets(layer).includes(target)) throw new Error('Unsupported timeline container conversion');
	const converted = createTimelineContainerLayer(target, layer.id, layer.name);
	converted.color = deepClone(layer.color);
	converted.isDisabled = layer.isDisabled;
	converted.layers = layer.layers;
	if (hasTimelineLayerParameters(layer) && hasTimelineLayerParameters(converted)) {
		converted.automationGraphs = deepClone(layer.automationGraphs);
		if (layer.customParameterDefs != null) converted.customParameterDefs = deepClone(layer.customParameterDefs);
		if (layer.customParameterValues != null) converted.customParameterValues = deepClone(layer.customParameterValues);
	}
	if (layer.layerType === 'transform' && converted.layerType === 'group') {
		const values = layer.transformParamValues;
		converted.forceDisableMotionBlur = layer.forceDisableMotionBlur;
		converted.compositingParamValues.position = deepClone(values.position);
		converted.compositingParamValues.scale = deepClone(values.scale);
		converted.compositingParamValues.rotation = deepClone(values.rotation);
		converted.compositingParamValues.depth = deepClone(values.z);
	}
	return converted;
}
