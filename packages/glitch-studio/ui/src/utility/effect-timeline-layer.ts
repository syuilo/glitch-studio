import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createEffectTimelineLayer(definition: EffectDefinition, startMs: number): TimelineEffectLayer {
	return {
		id: genId(),
		name: definition.displayName,
		layerType: 'effect',
		transformTarget: definition.kind === 'modify' ? 'region' : 'image',
		effectId: definition.id,
		isDisabled: false,
		color: null,
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		resolution: { mode: 'auto' },
		automationGraphs: [],
		effectParamValues: Object.fromEntries(Object.keys(definition.paramDefs).map(key => [key, getEffectLayerParameterDefault(definition, key)])),
		forceDisableMotionBlur: false,
		mask: null,
		coordinateSpace: 'screen',
		compositingParamValues: {
			depth: { inputSource: 'literal', value: 0 },
			clipToFrame: { inputSource: 'literal', value: false },
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
