import type { Asset, Player } from '@glitch/shared/types.ts';
import type { ProjectVisualModule } from '@glitch/shared/project/types.ts';
import type { Timeline } from '@glitch/shared/timeline/types.ts';
import type { Ref } from 'vue';

export type AppState = {
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<Asset[]>;
	players: Ref<Player[]>;
	visualModules: Ref<ProjectVisualModule[]>;
	timeline: Ref<Timeline>;
};
