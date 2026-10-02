import { createTimelineClipTiming } from '@glitch/shared/timeline/timing.ts';
import { getEffectLayerParameterDefault } from '@glitch/shared/timeline/effect-layer.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import type { EffectDefinition } from '@glitch/shared/effect/effect-definition.ts';
import type { TimelineEffectLayer } from '@glitch/shared/timeline/types.ts';

export function createEffectTimelineLayer(definition: EffectDefinition, startMs: number): TimelineEffectLayer {
	return {
		id: genId(), name: definition.displayName, layerType: 'effect', effectId: definition.id,
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		resolution: { mode: 'auto' }, automationGraphs: [],
		effectParamValues: Object.fromEntries(Object.keys(definition.paramDefs).map(key => [key, getEffectLayerParameterDefault(definition, key)])),
		compositingParamValues: {
			fitMode: deepClone(timelineCompositingParamDefs.fitMode.defaultValue),
			blendMode: { inputSource: 'literal', value: definition.kind === 'modify' ? 'replace' : 'normal' },
			opacity: deepClone(timelineCompositingParamDefs.opacity.defaultValue),
			position: deepClone(timelineCompositingParamDefs.position.defaultValue),
			origin: deepClone(timelineCompositingParamDefs.origin.defaultValue),
			scale: deepClone(timelineCompositingParamDefs.scale.defaultValue),
			rotation: deepClone(timelineCompositingParamDefs.rotation.defaultValue),
		},
	};
}
