import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineImageLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createImageLayer(assetId: string, startMs: number, name = 'Image'): TimelineImageLayer {
	return {
		id: genId(),
		name,
		layerType: 'image',
		isDisabled: false,
		isSolo: false,
		color: null,
		forceDisableMotionBlur: false,
		clips: [{ id: genId(), assetId, ...createTimelineClipTiming(startMs, 5000) }],
		automationGraphs: [],
		mask: null,
		layerMask: null,
		isIncludedInComposite: true,
		coordinateSpace: 'screen',
		compositingParamValues: deepClone({
			depth: createDefaultParameterBinding(timelineCompositingParamDefs.depth),
			clipToFrame: createDefaultParameterBinding(timelineCompositingParamDefs.clipToFrame),
			fitMode: createDefaultParameterBinding(timelineCompositingParamDefs.fitMode),
			blendMode: createDefaultParameterBinding(timelineCompositingParamDefs.blendMode),
			opacity: createDefaultParameterBinding(timelineCompositingParamDefs.opacity),
			position: createDefaultParameterBinding(timelineCompositingParamDefs.position),
			origin: createDefaultParameterBinding(timelineCompositingParamDefs.origin),
			scale: createDefaultParameterBinding(timelineCompositingParamDefs.scale),
			rotation: createDefaultParameterBinding(timelineCompositingParamDefs.rotation),
		}),
	};
}
