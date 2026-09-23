export type EffectStatus =
	| { type: 'loading' }
	| { type: 'ready' }
	| { type: 'error'; message: string };

export type EffectInstanceState = {
	status: EffectStatus;
	// 未描画・未使用の遅延出力・バイパス中はnull。仮確保のサイズは公開しない。
	outputs: Record<string, { width: number; height: number } | null>;
};

export type EffectStatusSource =
	| { type: 'live'; instanceId: string; visualModuleId: string }
	| { type: 'timelineLayer'; instanceId: string; visualModuleId: string; layerId: string };
