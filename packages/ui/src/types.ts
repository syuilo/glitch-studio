import type { Asset, Player } from '@glitch/shared/types.ts';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { Timeline } from '@glitch/shared/timeline/types.ts';
import type { Ref } from 'vue';

export type AppState = {
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<Asset[]>;
	players: Ref<Player[]>;
	visualModules: Ref<VisualModule[]>;
	timeline: Ref<Timeline>;
};
