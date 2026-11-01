import { createTimelineCameraParameterValues } from '@gs/subsystems_timeline_shared/layers/camera/camera.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineCameraLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export function createCameraTimelineLayer(startMs: number, resolution: Resolution = { width: 1, height: 1 }): TimelineCameraLayer {
	return {
		id: genId(),
		name: 'Camera',
		layerType: 'camera',
		isDisabled: false,
		color: null,
		automationGraphs: [],
		forceDisableMotionBlur: false,
		cameraParamValues: createTimelineCameraParameterValues(resolution),
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
	};
}
