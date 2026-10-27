import { validateTimelineLayerCustomParameterDefinitions } from './custom-parameters.ts';
import { hasTimelineLayerParameters } from './types.ts';
import { staticParameterShape } from '@gs/shared/parameter/static-parameter.ts';
import { validateTimelineLayerStructure } from './scenes.ts';
import { validateTimelineParameterTree } from './parameter-binding.ts';
import { getEffectLayerParameterDefault } from './layers/effect/effect-layer.ts';
import { getTimelineVisualModuleArgumentDefault } from './layers/visual-module/visual-module-arguments.ts';
import { timelineCompositingParamDefs } from './timeline-compositing.ts';
import { timelineAudioParamDefs } from './timeline-audio.ts';
import { timelineCameraParamDefs } from './layers/camera/camera.ts';
import { timelineTransformParamDefs } from './layers/transform/transform.ts';
import { getShapeParameterDefinitions } from './layers/shape/shape.ts';
import { textParamDefs } from './layers/text/text.ts';
import { voicevoxSubtitleParamDefs } from './layers/voicevox/voicevox-subtitle.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineLayer } from './types.ts';

type ParameterGroup = { name: string; definitions: Record<string, ParameterDefinition>; values: Record<string, ParameterBindingBase>; imageInput?: boolean; audioInput?: boolean };

function parameterGroups(layer: TimelineLayer, visualModule?: VisualModule | null, effect?: EffectDefinition | null): ParameterGroup[] {
	const groups: ParameterGroup[] = [];
	if (!hasTimelineLayerParameters(layer)) return groups;
	const customParameterDefs = layer.customParameterDefs ?? [];
	if (customParameterDefs.length > 0) groups.push({
		name: 'customParameterValues',
		definitions: Object.fromEntries(customParameterDefs.map(definition => [definition.id, definition])),
		values: Object.fromEntries(customParameterDefs.map(definition => [definition.id, layer.customParameterValues?.[definition.id] ?? definition.defaultValue])),
	});
	const add = (name: string, definitions: Record<string, ParameterDefinition>, values: Record<string, ParameterBindingBase>) => groups.push({ name, definitions, values });
	if ('compositingParamValues' in layer) add('compositingParamValues', timelineCompositingParamDefs, layer.compositingParamValues);
	if ('audioParamValues' in layer) add('audioParamValues', timelineAudioParamDefs, layer.audioParamValues);
	if (layer.layerType === 'text') add('textParamValues', textParamDefs, layer.textParamValues);
	if (layer.layerType === 'voicevox') add('subtitleParamValues', voicevoxSubtitleParamDefs, layer.subtitleParamValues);
	if (layer.layerType === 'camera') add('cameraParamValues', timelineCameraParamDefs, layer.cameraParamValues);
	if (layer.layerType === 'transform') add('transformParamValues', timelineTransformParamDefs, layer.transformParamValues);
	if (layer.layerType === 'shape') add('shape', getShapeParameterDefinitions(layer.shape.type), layer.shape.paramValues);
	if (layer.layerType === 'effect' && effect) groups.push({
		name: 'effectParamValues',
		definitions: effect.paramDefs,
		values: Object.fromEntries(Object.keys(effect.paramDefs).map(key => [key, layer.effectParamValues[key] ?? getEffectLayerParameterDefault(effect, key)])),
		imageInput: true,
		audioInput: true,
	});
	if ('visualModuleParamValues' in layer && visualModule) groups.push({
		name: 'visualModuleParamValues',
		definitions: Object.fromEntries(visualModule.paramDefs.map(def => [def.id, def])),
		values: Object.fromEntries(visualModule.paramDefs.map(def => [def.id, layer.visualModuleParamValues[def.id] ?? getTimelineVisualModuleArgumentDefault(visualModule, def)])),
		imageInput: true,
		audioInput: true,
	});
	return groups;
}

export function timelineLayerStaticShape(layer: TimelineLayer, visualModule?: VisualModule | null, effect?: EffectDefinition | null): unknown {
	const { name, isDisabled, ...shape } = layer;
	const result: Record<string, unknown> = { ...shape };
	delete result.automationGraphs;
	delete result.layers;
	delete result.visualModule;
	for (const group of parameterGroups(layer, visualModule, effect)) {
		result[group.name] = Object.entries(group.values).map(([key, binding]) => [key, staticParameterShape(group.definitions[key], binding)]);
	}
	if (layer.layerType === 'shape') result.shape = [layer.shape.type, result.shape];
	return result;
}

// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function inspectTimelineLayer(layer: TimelineLayer, visualModule: VisualModule | null | undefined, effect: EffectDefinition | null | undefined,
	onValue: (definition: ParameterDefinition, binding: unknown) => void): void {
	// コンテナの設定編集で子孫を再検証しない。子は各自の検証単位を持つ。
	validateTimelineLayerStructure(layer);
	if (hasTimelineLayerParameters(layer)) validateTimelineLayerCustomParameterDefinitions(layer.customParameterDefs ?? []);
	if (layer.layerType === 'effect' && !effect) throw new Error('Effect not found: ' + layer.effectId);
	if ('visualModuleParamValues' in layer && !visualModule) throw new Error('Visual Module not found');
	for (const group of parameterGroups(layer, visualModule, effect)) {
		for (const [key, binding] of Object.entries(group.values)) {
			const definition = group.definitions[key];
			if (!definition) throw new Error('Unknown layer parameter: ' + key);
			// Visual Moduleの画像入力はInノードの公開ポートだけ。struct/arrayの内部にある
			// canNodeを公開ポートと誤認すると、CPU引数評価へ画像Bindingを渡してしまう。
			const allowImageInput = (group.imageInput ?? false) && (group.name !== 'visualModuleParamValues' || definition.canNode === true);
			validateTimelineParameterTree(definition, binding, allowImageInput, group.audioInput ?? false, (leaf, value) => {
				if (group.name === 'effectParamValues' && (value.inputSource === 'lowerLayerOutput' || value.inputSource === 'anotherLayerOutput') && !('fitMode' in value)) throw new Error('Effect image input requires sampling');
				onValue(leaf, value);
			});
		}
	}
}
