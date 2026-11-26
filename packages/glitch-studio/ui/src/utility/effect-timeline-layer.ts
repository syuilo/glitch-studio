import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { EffectChoice } from './project-effects.ts';
import { getTimelineEffectOutput } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createEffectTimelineLayer(definition: EffectChoice, startMs: number): TimelineEffectLayer {
	getTimelineEffectOutput(definition);
	return {
		id: genId(),
		name: definition.displayName,
		layerType: 'effect',
		transformTarget: definition.kind === 'modify' ? 'region' : 'image',
		effectSource: deepClone(definition.effectSource),
		isDisabled: false,
		isSolo: false,
		color: null,
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		resolution: { mode: 'auto', scale: 1 },
		functionCurves: [],
		effectStaticSettings: createStaticSettingValues(definition.staticSettingDefs ?? {}),
		effectParamValues: Object.fromEntries(Object.keys(definition.paramDefs).map(key => [key, getEffectLayerParameterDefault(definition, key)])),
		forceDisableMotionBlur: false,
		mask: null,
		layerMask: null,
		isIncludedInComposite: true,
		coordinateSpace: 'screen',
		compositingParamValues: {
			depth: { inputSource: 'literal', value: 0 },
			clipToFrame: { inputSource: 'literal', value: false },
			fitMode: createDefaultParameterBinding(timelineCompositingParamDefs.fitMode),
			blendMode: { inputSource: 'literal', value: definition.kind === 'modify' ? 'replace' : 'normal' },
			opacity: createDefaultParameterBinding(timelineCompositingParamDefs.opacity),
			position: createDefaultParameterBinding(timelineCompositingParamDefs.position),
			origin: createDefaultParameterBinding(timelineCompositingParamDefs.origin),
			scale: createDefaultParameterBinding(timelineCompositingParamDefs.scale),
			rotation: createDefaultParameterBinding(timelineCompositingParamDefs.rotation),
		},
	};
}
