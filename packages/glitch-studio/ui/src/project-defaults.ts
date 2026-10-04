import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';

export const DEFAULT_TIMELINE_FPS = 60;
export const DEFAULT_TIMELINE_MOTION_BLUR: Readonly<TimelineMotionBlurSettings> = {
	enabled: false, shutterAngle: 360, samples: 32,
};
