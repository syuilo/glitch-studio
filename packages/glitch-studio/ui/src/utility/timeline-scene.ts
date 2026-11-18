import type { EditableTimelineParameterBinding } from '../types/parameter-edit.ts';
import { timelineTransformParamDefs } from '@gs/subsystems_timeline_shared/layers/transform/transform.ts';
import { timelineCameraParamDefs } from '@gs/subsystems_timeline_shared/layers/camera/camera.ts';
import { isTimelineVisualLayer, hasTimelineLayerParameters } from '@gs/subsystems_timeline_shared/types.ts';
import { getTimelineScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { getTimelineCompositingParameterDefinitions } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { getEffectDefinitions } from './project-effects.ts';
import { getTimelineCustomNodeGraphEffectArgumentDefault } from '@gs/subsystems_timeline_shared/layers/custom-node-graph-effect/custom-node-graph-effect-arguments.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { voicevoxSubtitleParamDefs } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts';
import { textParamDefs } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import { getShapeParameterDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import { getParameterPathLabel } from './parameter-label.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { TimelineEffectParameterBinding, TimelineParameterBinding, TimelineCustomNodeGraphEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
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
		case 'folder': return [];
		case 'parameterContainer': return ['publicParameter'];
		case 'audio': return ['publicParameter', 'audio'];
		case 'camera': return ['publicParameter', 'camera'];
		case 'transform': return ['publicParameter', 'transform'];
		case 'image': return ['publicParameter', 'compositing'];
		case 'group':
		case 'video':
		case 'scene': return ['publicParameter', 'compositing', 'audio'];
		case 'customNodeGraphEffect':
		case 'inlineCustomNodeGraphEffect': return ['publicParameter', 'compositing', 'customNodeGraphEffect'];
		case 'effect': return ['publicParameter', 'compositing', 'effect'];
		case 'voicevox': return ['publicParameter', 'compositing', 'voicevoxSubtitle', 'audio'];
		case 'text': return ['publicParameter', 'compositing', 'text'];
		case 'shape': return ['publicParameter', 'compositing', 'shape'];
	}
}

// 保存先が確定した場合だけ、そのドメインのBindingを書き込める。
// 動的なtargetで取得する一覧は読み取り専用にし、音量や合成設定へのlowerLayerOutputの書き込みを防ぐ。
export function getLayerParameterValues(layer: TimelineLayer, target: 'customNodeGraphEffect'): Record<string, TimelineCustomNodeGraphEffectParameterBinding>;
export function getLayerParameterValues(layer: TimelineLayer, target: 'effect'): Record<string, TimelineEffectParameterBinding>;
export function getLayerParameterValues(layer: TimelineLayer, target: 'publicParameter' | 'compositing' | 'audio' | 'camera' | 'transform' | 'shape' | 'text' | 'voicevoxSubtitle'): Record<string, TimelineParameterBinding>;
export function getLayerParameterValues(layer: TimelineLayer, target: TimelineParameterTarget): Readonly<Record<string, EditableTimelineParameterBinding>>;
export function getLayerParameterValues(layer: TimelineLayer, target: TimelineParameterTarget): Readonly<Record<string, EditableTimelineParameterBinding>> {
	if (target === 'publicParameter' && hasTimelineLayerParameters(layer)) return layer.publicParameterValues ?? {};
	if (target === 'compositing' && 'compositingParamValues' in layer) return layer.compositingParamValues;
	if (target === 'audio' && (layer.layerType === 'group' || layer.layerType === 'voicevox' || layer.layerType === 'scene' || layer.layerType === 'video' || layer.layerType === 'audio')) return layer.audioParamValues;
	if (target === 'customNodeGraphEffect' && (layer.layerType === 'customNodeGraphEffect' || layer.layerType === 'inlineCustomNodeGraphEffect')) return layer.customNodeGraphEffectParamValues;
	if (target === 'effect' && layer.layerType === 'effect') return layer.effectParamValues;
	if (target === 'text' && layer.layerType === 'text') return layer.textParamValues;
	if (target === 'voicevoxSubtitle' && layer.layerType === 'voicevox') return layer.subtitleParamValues;
	if (target === 'shape' && layer.layerType === 'shape') return layer.shape.paramValues;
	if (target === 'transform' && layer.layerType === 'transform') return layer.transformParamValues;
	if (target === 'camera' && layer.layerType === 'camera') return layer.cameraParamValues;
	throw new Error('Invalid layer parameter target');
}

/**
 * キーの値編集・挿入は、保存した型の古い選択肢ではなく現在の定義を使う。
 */
export function getLayerParameterDefinitions(state: Pick<ProjectState, 'customNodeGraphEffects'> & Partial<Pick<ProjectState, 'customShaderEffects'>>, layer: TimelineLayer, target: TimelineParameterTarget): Record<string, ParameterDefinition> {
	if (!getLayerParameterTargets(layer).includes(target)) throw new Error('Invalid layer parameter target');
	if (target === 'publicParameter' && hasTimelineLayerParameters(layer)) return Object.fromEntries((layer.publicParameterDefs ?? []).map(def => [def.id, def]));
	if (target === 'audio') return timelineAudioParamDefs;
	if (target === 'transform') return timelineTransformParamDefs;
	if (target === 'camera') return timelineCameraParamDefs;
	if (target === 'compositing' && isTimelineVisualLayer(layer)) return getTimelineCompositingParameterDefinitions(layer.mask);
	if (target === 'effect' && layer.layerType === 'effect') return getEffectDefinitions(state)[layer.effectId].paramDefs;
	if (target === 'text' && layer.layerType === 'text') return textParamDefs;
	if (target === 'voicevoxSubtitle' && layer.layerType === 'voicevox') return voicevoxSubtitleParamDefs;
	if (target === 'shape' && layer.layerType === 'shape') return getShapeParameterDefinitions(layer.shape.type);
	const customNodeGraphEffect = layer.layerType === 'inlineCustomNodeGraphEffect' ? layer.customNodeGraphEffect
		: layer.layerType === 'customNodeGraphEffect' ? state.customNodeGraphEffects.value.find(candidateCustomNodeGraphEffect => candidateCustomNodeGraphEffect.id === layer.customNodeGraphEffectId) : null;
	return Object.fromEntries(customNodeGraphEffect?.paramDefs.map(def => [def.id, def]) ?? []);
}

export function resolveLayerParameter(state: Pick<ProjectState, 'customNodeGraphEffects'> & Partial<Pick<ProjectState, 'customShaderEffects'>>, layer: TimelineLayer, target: TimelineParameterTarget, path: ParamPath) {
	const defs = getLayerParameterDefinitions(state, layer, target);
	const values = getLayerParameterValues(layer, target);
	// 未編集のCustom Node Graph Effect引数は定義の既定値を参照する。参照だけでは保存値を増やさない。
	if (path.length === 1 && values[path[0]] == null && defs[path[0]] != null) {
		if (target === 'customNodeGraphEffect') {
			const customNodeGraphEffect = layer.layerType === 'inlineCustomNodeGraphEffect' ? layer.customNodeGraphEffect
				: layer.layerType === 'customNodeGraphEffect' ? state.customNodeGraphEffects.value.find(customNodeGraphEffect => customNodeGraphEffect.id === layer.customNodeGraphEffectId) : null;
			const def = customNodeGraphEffect?.paramDefs.find(def => def.id === path[0]);
			if (customNodeGraphEffect && def) return { def, value: getTimelineCustomNodeGraphEffectArgumentDefault(customNodeGraphEffect, def) };
		}
		if (target === 'effect' && layer.layerType === 'effect') return { def: defs[path[0]], value: getEffectLayerParameterDefault(getEffectDefinitions(state)[layer.effectId], path[0]) };
		return { def: defs[path[0]], value: defs[path[0]].defaultValue };
	}
	const { def, value } = resolveParameter<EditableTimelineParameterBinding>(defs, values, path);
	return { def, value };
}

export function getLayerParameterDefinition(state: Pick<ProjectState, 'customNodeGraphEffects'> & Partial<Pick<ProjectState, 'customShaderEffects'>>, layer: TimelineLayer, target: TimelineParameterTarget, path: ParamPath): ParameterDefinition | null {
	try { return resolveLayerParameter(state, layer, target, path).def; } catch { return null; }
}

export function getLayerKeyframeParameters(state: Pick<ProjectState, 'customNodeGraphEffects'> & Partial<Pick<ProjectState, 'customShaderEffects'>>, layer: TimelineLayer) {
	const targetLabels: Record<TimelineParameterTarget, string> = {
		publicParameter: 'Public Parameters',
		customNodeGraphEffect: 'Custom Node Graph Effect',
		effect: 'Effect',
		shape: 'Shape',
		text: 'Text',
		voicevoxSubtitle: 'Subtitle',
		compositing: 'Compositing',
		audio: 'Audio',
		camera: 'Camera',
		transform: 'Transform',
	};
	return getLayerParameterTargets(layer).flatMap(target => {
		const defs = getLayerParameterDefinitions(state, layer, target);
		const values = getLayerParameterValues(layer, target);
		return [...walkParameters<EditableTimelineParameterBinding>(defs, values)].flatMap(({ path, def, value }) => value.inputSource === 'keyframesTimelineInline'
			? [{
				key: JSON.stringify([target, path]),
				paramPath: path,
				target,
				def,
				label: `${targetLabels[target]} / ${getParameterPathLabel(defs, values, path)}`,
				binding: value,
			}] : []);
	});
}
