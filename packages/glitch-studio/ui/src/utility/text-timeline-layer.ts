import { createTextParameterValues } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineTextLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createTextTimelineLayer(startMs: number): TimelineTextLayer {
	return {
		id: genId(), name: 'Text', layerType: 'text', textParamValues: createTextParameterValues(),
		isDisabled: false, automationGraphs: [],
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		compositingParamValues: {
			fitMode: deepClone(timelineCompositingParamDefs.fitMode.defaultValue),
			blendMode: deepClone(timelineCompositingParamDefs.blendMode.defaultValue),
			opacity: deepClone(timelineCompositingParamDefs.opacity.defaultValue),
			position: deepClone(timelineCompositingParamDefs.position.defaultValue),
			origin: deepClone(timelineCompositingParamDefs.origin.defaultValue),
			scale: deepClone(timelineCompositingParamDefs.scale.defaultValue),
			rotation: deepClone(timelineCompositingParamDefs.rotation.defaultValue),
		},
	};
}
