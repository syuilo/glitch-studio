import { createTimelineCameraParameterValues } from '@gs/subsystems_timeline_shared/layers/camera/camera.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineCameraLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createCameraTimelineLayer(startMs: number): TimelineCameraLayer {
	return {
		id: genId(), name: 'Camera', layerType: 'camera', isDisabled: false, color: null,
		automationGraphs: [], forceDisableMotionBlur: false,
		cameraParamValues: createTimelineCameraParameterValues(),
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
	};
}
