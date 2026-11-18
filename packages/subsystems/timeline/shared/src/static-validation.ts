import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { getTimelineLayerStaticSettings } from './layer-static-settings.ts';
import { validateTimelineLayerPublicParameterDefinitions } from './public-parameters.ts';
import { hasTimelineLayerParameters } from './types.ts';
import { staticParameterShape } from '@gs/shared/parameter/static-parameter.ts';
import { validateTimelineLayerStructure } from './scenes.ts';
import { validateTimelineParameterTree } from './parameter-binding.ts';
import { getTimelineEffectLayerDefinition, getTimelineEffectLayerParameterBindings, validateTimelineEffectLayer } from './layers/effect/effect-layer.ts';
import { timelineCompositingParamDefs } from './timeline-compositing.ts';
import { timelineAudioParamDefs } from './timeline-audio.ts';
import { timelineCameraParamDefs } from './layers/camera/camera.ts';
import { timelineTransformParamDefs } from './layers/transform/transform.ts';
import { getShapeParameterDefinitions } from './layers/shape/shape.ts';
import { textParamDefs } from './layers/text/text.ts';
import { voicevoxSubtitleParamDefs } from './layers/voicevox/voicevox-subtitle.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import type { TimelineLayer } from './types.ts';

type ParameterGroup = { name: string; definitions: Readonly<Record<string, ParameterDefinition>>; values: Record<string, ParameterBindingBase> };

function parameterGroups(layer: TimelineLayer): ParameterGroup[] {
	const groups: ParameterGroup[] = [];
	if (!hasTimelineLayerParameters(layer)) return groups;
	const publicParameterDefs = layer.publicParameterDefs ?? [];
	if (publicParameterDefs.length > 0) groups.push({
		name: 'publicParameterValues',
		definitions: Object.fromEntries(publicParameterDefs.map(definition => [definition.id, definition])),
		values: Object.fromEntries(publicParameterDefs.map(definition => [definition.id, layer.publicParameterValues?.[definition.id] ?? definition.defaultValue])),
	});
	const add = (name: string, definitions: Record<string, ParameterDefinition>, values: Record<string, ParameterBindingBase>) => groups.push({ name, definitions, values });
	if ('compositingParamValues' in layer) add('compositingParamValues', timelineCompositingParamDefs, layer.compositingParamValues);
	if ('audioParamValues' in layer) add('audioParamValues', timelineAudioParamDefs, layer.audioParamValues);
	if (layer.layerType === 'text') add('textParamValues', textParamDefs, layer.textParamValues);
	if (layer.layerType === 'voicevox') add('subtitleParamValues', voicevoxSubtitleParamDefs, layer.subtitleParamValues);
	if (layer.layerType === 'camera') add('cameraParamValues', timelineCameraParamDefs, layer.cameraParamValues);
	if (layer.layerType === 'transform') add('transformParamValues', timelineTransformParamDefs, layer.transformParamValues);
	if (layer.layerType === 'shape') add('shape', getShapeParameterDefinitions(layer.shape.type), layer.shape.paramValues);
	return groups;
}

export function timelineLayerStaticShape(layer: TimelineLayer, catalog: EffectCatalog): unknown {
	const { name, isDisabled, ...shape } = layer;
	const result: Record<string, unknown> = { ...shape };
	delete result.automationGraphs;
	delete result.layers;
	const groups = parameterGroups(layer);
	if (layer.layerType === 'effect') {
		const definition = getTimelineEffectLayerDefinition(layer, catalog);
		// 同じ参照IDでも公開型や主ポートが編集されると、既存の配線・既定の入力割当を再検証する必要がある。
		result.effectInterface = [definition.paramDefs, definition.outputDefs, definition.primaryInputId, definition.primaryAudioInputId, definition.primaryOutputId];
		groups.push({ name: 'effectParamValues', definitions: definition.paramDefs, values: getTimelineEffectLayerParameterBindings(layer, definition) });
	}
	for (const group of groups) {
		result[group.name] = Object.entries(group.values).map(([key, binding]) => [key, staticParameterShape(group.definitions[key], binding)]);
	}
	if (layer.layerType === 'shape') result.shape = [layer.shape.type, result.shape];
	return result;
}

export function inspectTimelineLayer(layer: TimelineLayer, catalog: EffectCatalog,
	onValue: (definition: ParameterDefinition, binding: unknown) => void): void {
	// コンテナの設定編集で子孫を再検証しない。子は各自の検証単位を持つ。
	validateTimelineLayerStructure(layer);
	const staticSettings = getTimelineLayerStaticSettings(layer);
	validateStaticSettings(staticSettings.definitions, staticSettings.values ?? {});
	if (hasTimelineLayerParameters(layer)) validateTimelineLayerPublicParameterDefinitions(layer.publicParameterDefs ?? []);
	if (layer.layerType === 'effect') validateTimelineEffectLayer(layer, catalog, onValue);
	for (const group of parameterGroups(layer)) {
		for (const [key, binding] of Object.entries(group.values)) {
			const definition = group.definitions[key];
			if (!Object.hasOwn(group.definitions, key)) throw new Error('Unknown layer parameter: ' + key);
			validateTimelineParameterTree(definition, binding, false, false, onValue);
		}
	}
}
