import { createShape, shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { ShapeType } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { TimelineShapeLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createShapeTimelineLayer(type: ShapeType, startMs: number): TimelineShapeLayer {
	return {
		id: genId(), name: shapeDefinitions[type].label, layerType: 'shape', shape: createShape(type),
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
