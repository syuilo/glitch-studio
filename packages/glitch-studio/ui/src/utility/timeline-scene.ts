import { getTimelineScene } from '@gs/shared/timeline/scenes.ts';
import { timelineAudioParamDefs } from '@gs/shared/timeline/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/shared/timeline/timeline-compositing.ts';
import { effectDefinitions } from '@gs/shared/effect/effect-definitions.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import { getParameterPathLabel } from './parameter-label.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { AppState } from '../types.ts';
import type { TimelineLayer, TimelineParameterTarget } from '@gs/shared/timeline/types.ts';

export type { TimelineParameterTarget } from '@gs/shared/timeline/types.ts';

export function getScene(state: AppState, sceneId: string) {
	return getTimelineScene(state.timelineScenes.value, sceneId);
}

/** キーフレームの表示と選択で、存在しないパラメータ群を参照しないよう一覧を共有する。 */
export function getLayerParameterTargets(layer: TimelineLayer): readonly TimelineParameterTarget[] {
	switch (layer.layerType) {
		case 'audio': return ['audio'];
		case 'image': return ['compositing'];
		case 'video':
		case 'scene': return ['compositing', 'audio'];
		case 'visualModule':
		case 'inlineVisualModule': return ['compositing', 'module'];
		case 'effect': return ['compositing', 'effect'];
	}
}

export function getLayerParameterValues(layer: TimelineLayer, target: TimelineParameterTarget): Record<string, ParameterBinding> {
	if (target === 'compositing' && layer.layerType !== 'audio') return layer.compositingParamValues;
	if (target === 'audio' && (layer.layerType === 'scene' || layer.layerType === 'video' || layer.layerType === 'audio')) return layer.audioParamValues;
	if (target === 'module' && (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule')) return layer.visualModuleParamValues;
	if (target === 'effect' && layer.layerType === 'effect') return layer.effectParamValues;
	throw new Error('Invalid layer parameter target');
}

/** キーの値編集・挿入は、保存した型の古い選択肢ではなく現在の定義を使う。 */
export function getLayerParameterDefinitions(state: Pick<AppState, 'visualModules'>, layer: TimelineLayer, target: TimelineParameterTarget): Record<string, ParameterDefinition> {
	if (!getLayerParameterTargets(layer).includes(target)) throw new Error('Invalid layer parameter target');
	if (target === 'audio') return timelineAudioParamDefs;
	if (target === 'compositing') return timelineCompositingParamDefs;
	if (target === 'effect' && layer.layerType === 'effect') return effectDefinitions[layer.effectId].paramDefs;
	const module = layer.layerType === 'inlineVisualModule' ? layer.visualModule
		: layer.layerType === 'visualModule' ? state.visualModules.value.find(module => module.id === layer.visualModuleId) : undefined;
	return Object.fromEntries(module?.paramDefs.map(def => [def.id, def]) ?? []);
}

export function resolveLayerParameter(state: Pick<AppState, 'visualModules'>, layer: TimelineLayer, target: TimelineParameterTarget, path: ParamPath) {
	const defs = getLayerParameterDefinitions(state, layer, target);
	const values = getLayerParameterValues(layer, target);
	// 未編集のモジュール引数は定義の既定値を参照する。参照だけでは保存値を増やさない。
	if (path.length === 1 && values[path[0]] == null && defs[path[0]] != null) {
		return { def: defs[path[0]], value: defs[path[0]].defaultValue as ParameterBinding, setValue: (value: ParameterBinding) => { values[path[0]] = value; } };
	}
	return resolveParameter(defs, values, path);
}

export function getLayerParameterDefinition(state: Pick<AppState, 'visualModules'>, layer: TimelineLayer, target: TimelineParameterTarget, path: ParamPath): ParameterDefinition | undefined {
	try { return resolveLayerParameter(state, layer, target, path).def; } catch { return undefined; }
}

export function getLayerKeyframeParameters(state: Pick<AppState, 'visualModules'>, layer: TimelineLayer) {
	const targetLabels: Record<TimelineParameterTarget, string> = { module: 'Module', effect: 'Effect', compositing: 'Compositing', audio: 'Audio' };
	return getLayerParameterTargets(layer).flatMap(target => {
		const defs = getLayerParameterDefinitions(state, layer, target);
		const values = getLayerParameterValues(layer, target);
		return [...walkParameters(defs, values)].flatMap(({ path, def, value }) => value.inputSource === 'keyframesTimelineInline'
			? [{ key: JSON.stringify([target, path]), paramPath: path, target, def,
				label: `${targetLabels[target]} / ${getParameterPathLabel(defs, values, path)}`, binding: value }] : []);
	});
}
