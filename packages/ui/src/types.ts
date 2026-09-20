import type { Asset, Player, VisualModule, Timeline } from '@glitch/shared/types.ts';
import type { Ref } from 'vue';

export type AppState = {
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<Asset[]>;
	players: Ref<Player[]>;
	visualModules: Ref<VisualModule[]>;
	timeline: Ref<Timeline>;
};
