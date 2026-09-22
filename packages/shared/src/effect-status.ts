export type EffectStatus =
	| { type: 'loading' }
	| { type: 'ready' }
	| { type: 'error'; message: string };

export type EffectStatusSource =
	| { type: 'live'; instanceId: string; visualModuleId: string }
	| { type: 'timelineLayer'; instanceId: string; visualModuleId: string; layerId: string };
