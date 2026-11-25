import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { createTextParameterValues } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineTextLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createTextTimelineLayer(startMs: number): TimelineTextLayer {
	return {
		id: genId(),
		name: 'Text',
		layerType: 'text',
		textStaticSettings: { font: null },
		textParamValues: createTextParameterValues(),
		isDisabled: false,
		isSolo: false,
		color: null,
		functionCurves: [],
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		forceDisableMotionBlur: false,
		mask: null,
		layerMask: null,
		isIncludedInComposite: true,
		coordinateSpace: 'screen',
		compositingParamValues: {
			depth: { inputSource: 'literal', value: 0 },
			clipToFrame: { inputSource: 'literal', value: false },
			fitMode: createDefaultParameterBinding(timelineCompositingParamDefs.fitMode),
			blendMode: createDefaultParameterBinding(timelineCompositingParamDefs.blendMode),
			opacity: createDefaultParameterBinding(timelineCompositingParamDefs.opacity),
			position: createDefaultParameterBinding(timelineCompositingParamDefs.position),
			origin: createDefaultParameterBinding(timelineCompositingParamDefs.origin),
			scale: createDefaultParameterBinding(timelineCompositingParamDefs.scale),
			rotation: createDefaultParameterBinding(timelineCompositingParamDefs.rotation),
		},
	};
}
