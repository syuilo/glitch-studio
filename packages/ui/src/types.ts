import type { Asset, GsNode, Macro, GsAutomation, Player, NodeGraph, Timeline } from '@glitch/shared/types.ts';
import type { Ref } from 'vue';

export type AppState = {
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<Asset[]>;
	players: Ref<Player[]>;
	nodeGraphs: Ref<NodeGraph[]>;
	macros: Ref<Macro[]>;
	automations: Ref<GsAutomation[]>;
	timeline: Ref<Timeline>;
};
