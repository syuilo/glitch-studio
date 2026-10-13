// PlayerはGlitch Studioの取得元。共通の音声型やTimelineのBindingに持ち込まない。
export type PlayerAudioSourceSelection = { type: 'player'; playerId: string } | null;

export function validatePlayerAudioSourceSelection(value: unknown): asserts value is PlayerAudioSourceSelection {
	// nullは明示的な未選択。undefinedは保存データの欠落であり、型の保証を満たさないため拒否する。
	if (value === null) return;
	if (typeof value !== 'object' || !('type' in value) || value.type !== 'player'
		|| !('playerId' in value) || typeof value.playerId !== 'string' || !value.playerId) {
		throw new Error('Invalid player audio source');
	}
}
