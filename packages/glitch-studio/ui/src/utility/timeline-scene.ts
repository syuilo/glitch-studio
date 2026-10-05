import { getTimelineScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import { getParameterPathLabel } from './parameter-label.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { TimelineEffectParameterBinding, TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ProjectState } from '../Project.ts';
import type { TimelineLayer, TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';

export type { TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';

export function getScene(state: ProjectState, sceneId: string) {
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

// 保存先が確定した場合だけ、そのドメインのBindingを書き込める。
// 動的なtargetで取得する一覧は読み取り専用にし、音量や合成設定へのlayerInputの書き込みを防ぐ。
export function getLayerParameterValues(layer: TimelineLayer, target: 'effect'): Record<string, TimelineEffectParameterBinding>;
export function getLayerParameterValues(layer: TimelineLayer, target: Exclude<TimelineParameterTarget, 'effect'>): Record<string, TimelineParameterBinding>;
export function getLayerParameterValues(layer: TimelineLayer, target: TimelineParameterTarget): Readonly<Record<string, TimelineEffectParameterBinding>>;
export function getLayerParameterValues(layer: TimelineLayer, target: TimelineParameterTarget): Readonly<Record<string, TimelineEffectParameterBinding>> {
	if (target === 'compositing' && layer.layerType !== 'audio') return layer.compositingParamValues;
	if (target === 'audio' && (layer.layerType === 'scene' || layer.layerType === 'video' || layer.layerType === 'audio')) return layer.audioParamValues;
	if (target === 'module' && (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule')) return layer.visualModuleParamValues;
	if (target === 'effect' && layer.layerType === 'effect') return layer.effectParamValues;
	throw new Error('Invalid layer parameter target');
}

/** キーの値編集・挿入は、保存した型の古い選択肢ではなく現在の定義を使う。 */
export function getLayerParameterDefinitions(state: Pick<ProjectState, 'visualModules'>, layer: TimelineLayer, target: TimelineParameterTarget): Record<string, ParameterDefinition> {
	if (!getLayerParameterTargets(layer).includes(target)) throw new Error('Invalid layer parameter target');
	if (target === 'audio') return timelineAudioParamDefs;
	if (target === 'compositing') return timelineCompositingParamDefs;
	if (target === 'effect' && layer.layerType === 'effect') return effectDefinitions[layer.effectId].paramDefs;
	const module = layer.layerType === 'inlineVisualModule' ? layer.visualModule
		: layer.layerType === 'visualModule' ? state.visualModules.value.find(module => module.id === layer.visualModuleId) : undefined;
	return Object.fromEntries(module?.paramDefs.map(def => [def.id, def]) ?? []);
}

export function resolveLayerParameter(state: Pick<ProjectState, 'visualModules'>, layer: TimelineLayer, target: TimelineParameterTarget, path: ParamPath) {
	const defs = getLayerParameterDefinitions(state, layer, target);
	const values = getLayerParameterValues(layer, target);
	// 未編集のモジュール引数は定義の既定値を参照する。参照だけでは保存値を増やさない。
	if (path.length === 1 && values[path[0]] == null && defs[path[0]] != null) {
		return { def: defs[path[0]], value: defs[path[0]].defaultValue };
	}
	const { def, value } = resolveParameter<TimelineEffectParameterBinding>(defs, values, path);
	return { def, value };
}

export function getLayerParameterDefinition(state: Pick<ProjectState, 'visualModules'>, layer: TimelineLayer, target: TimelineParameterTarget, path: ParamPath): ParameterDefinition | undefined {
	try { return resolveLayerParameter(state, layer, target, path).def; } catch { return undefined; }
}

export function getLayerKeyframeParameters(state: Pick<ProjectState, 'visualModules'>, layer: TimelineLayer) {
	const targetLabels: Record<TimelineParameterTarget, string> = { module: 'Module', effect: 'Effect', compositing: 'Compositing', audio: 'Audio' };
	return getLayerParameterTargets(layer).flatMap(target => {
		const defs = getLayerParameterDefinitions(state, layer, target);
		const values = getLayerParameterValues(layer, target);
		return [...walkParameters<TimelineEffectParameterBinding>(defs, values)].flatMap(({ path, def, value }) => value.inputSource === 'keyframesTimelineInline'
			? [{ key: JSON.stringify([target, path]), paramPath: path, target, def,
				label: `${targetLabels[target]} / ${getParameterPathLabel(defs, values, path)}`, binding: value }] : []);
	});
}
