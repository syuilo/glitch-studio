// PlayerはGlitch Studioの取得元。共通の音声型やTimelineのBindingに持ち込まない。
export type PlayerAudioSourceSelection = { type: 'player'; playerId: string } | null;

export function validatePlayerAudioSourceSelection(value: unknown): asserts value is PlayerAudioSourceSelection {
	const diagnostics = inspectPlayerAudioSourceSelection(value);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectPlayerAudioSourceSelection(value: unknown): import('@gs/shared/validation/diagnostic.ts').ValidationDiagnostic[] {
	return value === null || (typeof value === 'object' && value != null && 'type' in value && value.type === 'player'
		&& 'playerId' in value && typeof value.playerId === 'string' && value.playerId.length > 0)
		? [] : [{ code: 'audio.player', message: 'Invalid player audio source' }];
}
