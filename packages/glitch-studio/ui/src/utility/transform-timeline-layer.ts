import { createTimelineTransformParameterValues } from '@gs/subsystems_timeline_shared/layers/transform/transform.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineTransformLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createTransformTimelineLayer(): TimelineTransformLayer {
	return {
		id: genId(),
		name: 'Transform',
		layerType: 'transform',
		isDisabled: false,
		color: null,
		automationGraphs: [],
		forceDisableMotionBlur: false,
		transformParamValues: createTimelineTransformParameterValues(),
		layers: [],
	};
}
