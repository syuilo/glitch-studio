import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { getTimelineLayerStaticSettings } from './layer-static-settings.ts';
import { validateTimelineLayerPublicParameterDefinitions } from './public-parameters.ts';
import { hasTimelineLayerParameters } from './types.ts';
import { staticParameterShape } from '@gs/shared/parameter/static-parameter.ts';
import { validateTimelineLayerStructure } from './scenes.ts';
import { validateTimelineParameterTree } from './parameter-binding.ts';
import { getEffectLayerParameterDefault, validateTimelineEffectSource } from './layers/effect/effect-layer.ts';
import { timelineCompositingParamDefs } from './timeline-compositing.ts';
import { timelineAudioParamDefs } from './timeline-audio.ts';
import { timelineCameraParamDefs } from './layers/camera/camera.ts';
import { timelineTransformParamDefs } from './layers/transform/transform.ts';
import { getShapeParameterDefinitions } from './layers/shape/shape.ts';
import { textParamDefs } from './layers/text/text.ts';
import { voicevoxSubtitleParamDefs } from './layers/voicevox/voicevox-subtitle.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { EffectDefinitions } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { TimelineLayer } from './types.ts';

type ParameterGroup = { name: string; definitions: Record<string, ParameterDefinition>; values: Record<string, ParameterBindingBase>; imageInput?: boolean; audioInput?: boolean };

function parameterGroups(layer: TimelineLayer, effect?: EffectDefinition | null): ParameterGroup[] {
	const groups: ParameterGroup[] = [];
	if (!hasTimelineLayerParameters(layer)) return groups;
	const publicParameterDefs = layer.publicParameterDefs ?? [];
	if (publicParameterDefs.length > 0) groups.push({
		name: 'publicParameterValues',
		definitions: Object.fromEntries(publicParameterDefs.map(definition => [definition.id, definition])),
		values: Object.fromEntries(publicParameterDefs.map(definition => [definition.id, layer.publicParameterValues?.[definition.id] ?? createDefaultParameterBinding(definition)])),
	});
	const add = (name: string, definitions: Record<string, ParameterDefinition>, values: Record<string, ParameterBindingBase>) => groups.push({ name, definitions, values });
	if ('compositingParamValues' in layer) add('compositingParamValues', timelineCompositingParamDefs, layer.compositingParamValues);
	if ('audioParamValues' in layer) add('audioParamValues', timelineAudioParamDefs, layer.audioParamValues);
	if (layer.layerType === 'text') add('textParamValues', textParamDefs, layer.textParamValues);
	if (layer.layerType === 'voicevox') add('subtitleParamValues', voicevoxSubtitleParamDefs, layer.subtitleParamValues);
	if (layer.layerType === 'camera') add('cameraParamValues', timelineCameraParamDefs, layer.cameraParamValues);
	if (layer.layerType === 'transform') add('transformParamValues', timelineTransformParamDefs, layer.transformParamValues);
	if (layer.layerType === 'shape') add('shape', getShapeParameterDefinitions(layer.shape.type), layer.shape.paramValues);
	if (layer.layerType === 'effect' && effect != null) groups.push({
		name: 'effectParamValues',
		definitions: effect.paramDefs,
		values: Object.fromEntries(Object.keys(effect.paramDefs).map(key => [key, layer.effectParamValues[key] ?? getEffectLayerParameterDefault(effect, key)])),
		imageInput: true,
		audioInput: true,
	});
	return groups;
}

export function timelineLayerStaticShape(layer: TimelineLayer, effect?: EffectDefinition | null): unknown {
	const { name, isDisabled, ...shape } = layer;
	const result: Record<string, unknown> = { ...shape };
	delete result.functionCurves;
	delete result.layers;
	for (const group of parameterGroups(layer, effect)) {
		result[group.name] = Object.entries(group.values).map(([key, binding]) => [key, staticParameterShape(group.definitions[key], binding)]);
	}
	if (layer.layerType === 'shape') result.shape = [layer.shape.type, result.shape];
	return result;
}

export function inspectTimelineLayer(layer: TimelineLayer, definitions: EffectDefinitions,
	onValue: (definition: ParameterDefinition, binding: unknown) => void): void {
	// コンテナの設定編集で子孫を再検証しない。子は各自の検証単位を持つ。
	validateTimelineLayerStructure(layer);
	const effect = layer.layerType === 'effect' ? validateTimelineEffectSource(layer.effectSource, definitions) : null;
	const staticSettings = getTimelineLayerStaticSettings(layer, effect);
	validateStaticSettings(staticSettings.definitions, staticSettings.values ?? {});
	if (hasTimelineLayerParameters(layer)) validateTimelineLayerPublicParameterDefinitions(layer.publicParameterDefs ?? []);
	for (const group of parameterGroups(layer, effect)) {
		for (const [key, binding] of Object.entries(group.values)) {
			const definition = group.definitions[key];
			if (!definition) throw new Error('Unknown layer parameter: ' + key);
			validateTimelineParameterTree(definition, binding, group.imageInput ?? false, group.audioInput ?? false, onValue);
		}
	}
}
