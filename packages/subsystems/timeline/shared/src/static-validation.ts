import { inspectEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { inspectSceneResolution } from './scene-resolution.ts';
import { inspectTimelineParameters } from './parameter-validation.ts';
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { timelineCompositingParamDefs } from './timeline-compositing.ts';
import { timelineAudioParamDefs } from './timeline-audio.ts';
import { timelineCameraParamDefs } from './layers/camera/camera.ts';
import { timelineTransformParamDefs } from './layers/transform/transform.ts';
import { textParamDefs } from './layers/text/text.ts';
import { voicevoxSubtitleParamDefs } from './layers/voicevox/voicevox-subtitle.ts';
import { inspectVoicevoxLayer } from './layers/voicevox/voicevox.ts';
import { shapeDefinitions } from './layers/shape/shape.ts';
import { getEffectLayerParameterDefault } from './layers/effect/effect-layer.ts';
import { getTimelineVisualModuleArgumentDefault } from './layers/visual-module/visual-module-arguments.ts';
import { inspectTimelineMediaClipTiming } from './media-timing.ts';
import { inspectTimelineClips } from './timing.ts';
import { isTimelineContainerLayer } from './types.ts';
import type { TimelineLayer, TimelineScene } from './types.ts';

export function inspectTimelineSceneSettings(scene: Pick<TimelineScene, 'resolution'>): ValidationDiagnostic[] {
	return inspectSceneResolution(scene.resolution);
}

export function inspectTimelineLayer(layer: TimelineLayer, effectDefinitions?: Readonly<Record<string, EffectDefinition>>, resolveVisualModule?: (id: string) => VisualModule | undefined): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [];
	const report = (code: string, message: string) => diagnostics.push({ code, message });
	if (!isTimelineContainerLayer(layer)) {
		diagnostics.push(...inspectTimelineClips(layer.clips));
		for (const clip of layer.clips) {
			if ('sourceInMs' in clip) {
				diagnostics.push(...inspectTimelineMediaClipTiming(clip));
			} else if ('contentOffsetMs' in clip && (!Number.isFinite(clip.contentOffsetMs) || clip.contentOffsetMs < 0 || !Number.isFinite(clip.contentOffsetMs + clip.durationMs))) report('clip.offset', 'Invalid content offset');
		}
	}
	if ('compositingParamValues' in layer) diagnostics.push(...inspectTimelineParameters(timelineCompositingParamDefs, layer.compositingParamValues));
	if ('audioParamValues' in layer) diagnostics.push(...inspectTimelineParameters(timelineAudioParamDefs, layer.audioParamValues));
	switch (layer.layerType) {
		case 'transform': diagnostics.push(...inspectTimelineParameters(timelineTransformParamDefs, layer.transformParamValues)); break;
		case 'camera': diagnostics.push(...inspectTimelineParameters(timelineCameraParamDefs, layer.cameraParamValues)); break;
		case 'text': diagnostics.push(...inspectTimelineParameters(textParamDefs, layer.textParamValues)); break;
		case 'voicevox':
			diagnostics.push(...inspectVoicevoxLayer(layer), ...inspectTimelineParameters(voicevoxSubtitleParamDefs, layer.subtitleParamValues)); break;
		case 'shape': {
			const definition = shapeDefinitions[layer.shape.type];
			if (!definition) report('shape.type', 'Unknown shape type');
			else diagnostics.push(...inspectTimelineParameters(definition.paramDefs, layer.shape.paramValues));
			break;
		}
		case 'effect': {
			const definition = effectDefinitions?.[layer.effectId];
			if (!definition && effectDefinitions) report('effect.missing', `Effect not found: ${layer.effectId}`);
			else if (definition) {
				const values = Object.fromEntries(Object.keys(definition.paramDefs).map(key => [key, layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key)]));
				diagnostics.push(...inspectTimelineParameters(definition.paramDefs, values, true, true));
			}
			diagnostics.push(...inspectEffectResolution(layer.resolution));
			break;
		}
		case 'visualModule':
		case 'inlineVisualModule': {
			const visualModule = layer.layerType === 'inlineVisualModule' ? layer.visualModule : resolveVisualModule?.(layer.visualModuleId);
			if (!visualModule && resolveVisualModule) report('visualModule.missing', `Visual Module not found: ${layer.layerType === 'visualModule' ? layer.visualModuleId : ''}`);
			else if (visualModule) {
				const definitions = Object.fromEntries(visualModule.paramDefs.map(def => [def.id, def]));
				const values = Object.fromEntries(visualModule.paramDefs.map(def => [def.id, layer.visualModuleParamValues[def.id] ?? getTimelineVisualModuleArgumentDefault(visualModule, def)]));
				diagnostics.push(...inspectTimelineParameters(definitions, values, false, true));
			}
			break;
		}
	}
	return diagnostics;
}
