
export type VoicevoxSettings = { styleId: number; speedScale: number };
export type VoicevoxUtterance = { id: string; timeMs: number; text: string; reading: string | null };
export type VoicevoxRequest = VoicevoxSettings & { text: string };
/** バイナリの所在や生成処理は呼び出し側が所有する。 */
export type PreparedSpeech = { key: string; sourceId: string; durationMs: number };
export type SpeechResolver = (request: VoicevoxRequest) => PreparedSpeech | undefined;

export function getVoicevoxRequest(settings: VoicevoxSettings, utterance: VoicevoxUtterance): VoicevoxRequest {
	return { styleId: settings.styleId, speedScale: settings.speedScale, text: utterance.reading ?? utterance.text };
}

export function getVoicevoxRequestKey(request: VoicevoxRequest): string {
	// 配置・表示本文・装飾は合成に影響しない。順序を固定してUndoや複製でも再利用する。
	return JSON.stringify([request.styleId, request.speedScale, request.text]);
}

export function createSpeechResolver(speech: readonly PreparedSpeech[]): SpeechResolver {
	const byKey = new Map(speech.map(item => [item.key, item]));
	return request => byKey.get(getVoicevoxRequestKey(request));
}

export function validateVoicevoxLayer(layer: { voicevox: VoicevoxSettings; utterances: readonly VoicevoxUtterance[] }): void {
	if (!Number.isSafeInteger(layer.voicevox.styleId) || layer.voicevox.styleId < 0 || !Number.isFinite(layer.voicevox.speedScale) || layer.voicevox.speedScale < 0.5 || layer.voicevox.speedScale > 2) throw new Error('Invalid VOICEVOX settings');
	const ids = new Set<string>();
	const times = new Set<number>();
	for (const utterance of layer.utterances) {
		if (!utterance.id || ids.has(utterance.id) || times.has(utterance.timeMs) || !Number.isSafeInteger(utterance.timeMs) || utterance.timeMs < 0 || typeof utterance.text !== 'string' || (utterance.reading !== null && typeof utterance.reading !== 'string')) throw new Error('Invalid VOICEVOX utterance');
		ids.add(utterance.id);
		times.add(utterance.timeMs);
	}
}

export function getVoicevoxSubtitle(utterances: readonly VoicevoxUtterance[], sceneTimeMs: number): string {
	return utterances.filter(utterance => utterance.timeMs <= sceneTimeMs).sort((a, b) => b.timeMs - a.timeMs)[0]?.text ?? '';
}
