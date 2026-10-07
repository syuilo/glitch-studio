import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';

/** Undo用の結果だけを保持するLRU。現行の発話や書き出しの音声はこの上限に含めない。 */
export class GeneratedSpeechCache {
	private entries = new Map<string, { speech: GeneratedSpeech; bytes: number }>();
	private bytes = 0;
	private readonly maxBytes: number;
	private readonly maxEntries: number;

	constructor(limits: { maxBytes?: number; maxEntries?: number } = {}) {
		this.maxBytes = limits.maxBytes ?? 128 * 1024 * 1024;
		this.maxEntries = limits.maxEntries ?? 256;
	}

	has(key: string): boolean { return this.entries.has(key); }

	get(key: string): GeneratedSpeech | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.speech;
	}

	take(key: string): GeneratedSpeech | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		this.entries.delete(key);
		this.bytes -= entry.bytes;
		return entry.speech;
	}

	set(speech: GeneratedSpeech): void {
		this.take(speech.key);
		const { fileData, ...metadata } = speech;
		// WAVだけでなく長文のAudioQueryも計上し、小さい音声の大量蓄積は件数で制限する。
		const bytes = fileData.size + new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
		if (bytes > this.maxBytes || this.maxEntries <= 0) return;
		this.entries.set(speech.key, { speech, bytes });
		this.bytes += bytes;
		while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) this.take(this.entries.keys().next().value!);
	}

	clear(): void {
		this.entries.clear();
		this.bytes = 0;
	}
}
