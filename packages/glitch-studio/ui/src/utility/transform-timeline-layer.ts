import { createTimelineContainerLayer } from '@gs/subsystems_timeline_shared/container-layer.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineTransformLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createTransformTimelineLayer(): TimelineTransformLayer {
	return createTimelineContainerLayer('transform', genId(), 'Transform');
}
