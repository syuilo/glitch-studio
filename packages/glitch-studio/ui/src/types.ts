import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { Ref } from 'vue';

export type AppState = {
	timelineFps: Ref<number>;
	timelineMotionBlur: Ref<TimelineMotionBlurSettings>;
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<Asset[]>;
	players: Ref<Player[]>;
	visualModules: Ref<ProjectVisualModule[]>;
	timelineScenes: Ref<TimelineScene[]>;
};
