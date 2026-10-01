import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { createUntrimmedTimelineLayerTiming } from '@glitch/shared/timeline/timing.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import type { TimelineImageLayer } from '@glitch/shared/timeline/types.ts';

export function createImageLayer(assetId: string, positionMs: number): TimelineImageLayer {
	return {
		id: genId(), layerType: 'image', assetId,
		...createUntrimmedTimelineLayerTiming(positionMs, 5000),
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
