import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineImageLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createImageLayer(assetId: string, startMs: number, name = 'Image'): TimelineImageLayer {
	return {
		id: genId(), name, layerType: 'image',
		clips: [{ id: genId(), assetId, ...createTimelineClipTiming(startMs, 5000) }],
		automationGraphs: [],
		compositingParamValues: deepClone({
			fitMode: timelineCompositingParamDefs.fitMode.defaultValue,
			blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
			opacity: timelineCompositingParamDefs.opacity.defaultValue,
			position: timelineCompositingParamDefs.position.defaultValue,
			origin: timelineCompositingParamDefs.origin.defaultValue,
			scale: timelineCompositingParamDefs.scale.defaultValue,
			rotation: timelineCompositingParamDefs.rotation.defaultValue,
		}),
	};
}
