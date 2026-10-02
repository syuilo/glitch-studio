import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { createTimelineClipTiming } from '@glitch/shared/timeline/timing.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import type { TimelineImageLayer } from '@glitch/shared/timeline/types.ts';

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
