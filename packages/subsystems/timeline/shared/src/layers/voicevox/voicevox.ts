
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';

export type VoicevoxSettings = { speedScale: number };
export type VoicevoxSubtitleDuration = { mode: 'fill' } | { mode: 'specified'; durationMs: number } | { mode: 'speech'; extensionMs: number };
export type VoicevoxUtterance = { id: string; timeMs: number; text: string; reading: string | null; styleId: number; subtitleDuration: VoicevoxSubtitleDuration };
export type VoicevoxRequest = VoicevoxSettings & { styleId: number; text: string };
/** バイナリの所在や生成処理は呼び出し側が所有する。 */
export type PreparedSpeech = { key: string; sourceId: string; durationMs: number };
export type SpeechResolver = (request: VoicevoxRequest) => PreparedSpeech | undefined;

export function getVoicevoxRequest(settings: VoicevoxSettings, utterance: VoicevoxUtterance): VoicevoxRequest {
	return { styleId: utterance.styleId, speedScale: settings.speedScale, text: utterance.reading ?? utterance.text };
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
	const diagnostics = inspectVoicevoxLayer(layer);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectVoicevoxLayer(layer: { voicevox: VoicevoxSettings; utterances: readonly VoicevoxUtterance[] }): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [];
	const report = (message: string) => diagnostics.push({ code: 'voicevox.settings', message });
	if (!Number.isFinite(layer.voicevox.speedScale) || layer.voicevox.speedScale < 0.5 || layer.voicevox.speedScale > 2) report('Invalid VOICEVOX settings');
	const ids = new Set<string>();
	const times = new Set<number>();
	for (const utterance of layer.utterances) {
		if (!utterance.id || ids.has(utterance.id) || times.has(utterance.timeMs) || !Number.isSafeInteger(utterance.timeMs) || utterance.timeMs < 0 || typeof utterance.text !== 'string' || (utterance.reading !== null && typeof utterance.reading !== 'string')) report('Invalid VOICEVOX utterance');
		if (!Number.isSafeInteger(utterance.styleId) || utterance.styleId < 0) report('Invalid VOICEVOX utterance style');
		const duration = utterance.subtitleDuration;
		if (!duration || !['fill', 'specified', 'speech'].includes(duration.mode)) { report('Invalid VOICEVOX subtitle duration'); continue; }
		const durationMs = duration.mode === 'specified' ? duration.durationMs : duration.mode === 'speech' ? duration.extensionMs : null;
		if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs < 0 || !Number.isSafeInteger(utterance.timeMs + durationMs))) report('Invalid VOICEVOX subtitle duration');
		ids.add(utterance.id);
		times.add(utterance.timeMs);
	}
	return diagnostics;
}
