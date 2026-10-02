import type { Asset, Player } from '@gs/shared/types.ts';
import type { ProjectVisualModule } from '@gs/shared/project/types.ts';
import type { TimelineScene } from '@gs/shared/timeline/types.ts';
import type { Ref } from 'vue';

export type AppState = {
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<Asset[]>;
	players: Ref<Player[]>;
	visualModules: Ref<ProjectVisualModule[]>;
	timelineScenes: Ref<TimelineScene[]>;
};
