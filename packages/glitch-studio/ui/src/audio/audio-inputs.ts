import { playerAudioSourceId } from '@gs/shared/audio.ts';
import type { AudioSourceId } from '@gs/shared/audio.ts';
import type { AudioCapture, AudioOutput } from './audio-output.ts';

type PlayerAudio = {
	media: HTMLMediaElement;
	volume: number;
	generation: number;
	gain: GainNode | null;
	source: MediaElementAudioSourceNode | null;
	capture: AudioCapture | null;
	ready: Promise<void> | null;
	cleanup: () => void;
};

/** Playerのメディア要素とレンダラーへの入力接続だけを所有する。共有出力は借用する。 */
export class AudioInputs {
	private players = new Map<string, PlayerAudio>();

	constructor(private output: AudioOutput,
		private attach: (id: AudioSourceId, port: MessagePort) => void,
		private reset: (id: AudioSourceId, generation: number | null) => void) {}

	private captureSource(id: AudioSourceId, source: AudioNode) {
		return this.output.captureSource(id, source, {
			attach: port => this.attach(id, port),
			reset: () => this.reset(id, null),
		});
	}

	public registerPlayer(id: string, media: HTMLMediaElement) {
		this.removePlayer(id);
		const entry: PlayerAudio = {
			media, volume: media.muted ? 0 : media.volume, generation: 0,
			gain: null, source: null, capture: null, ready: null, cleanup: () => {},
		};
		this.players.set(id, entry);
		const sync = () => entry.capture?.setState(!media.paused && !media.seeking && !media.ended, entry.generation);
		const reset = () => {
			entry.generation++;
			this.reset(playerAudioSourceId(id), entry.generation);
			sync();
		};
		for (const name of ['play', 'pause', 'ended', 'seeked'] as const) media.addEventListener(name, sync);
		for (const name of ['seeking', 'emptied', 'error'] as const) media.addEventListener(name, reset);
		entry.cleanup = () => {
			for (const name of ['play', 'pause', 'ended', 'seeked'] as const) media.removeEventListener(name, sync);
			for (const name of ['seeking', 'emptied', 'error'] as const) media.removeEventListener(name, reset);
		};
	}

	public async play(id: string) {
		const entry = this.players.get(id);
		if (!entry) return;
		// 毎回getOutputを呼び、ユーザー操作中に共有Contextをresumeする。
		const output = this.output.getOutput();
		if (!entry.ready) {
			entry.ready = this.initializePlayer(id, entry, output).catch(error => {
				entry.ready = null;
				throw error;
			});
		}
		await Promise.all([output, entry.ready]);
		if (this.players.get(id) !== entry) return;
		await entry.media.play();
	}

	private async initializePlayer(id: string, entry: PlayerAudio, readyOutput: Promise<GainNode>) {
		const output = await readyOutput;
		const context = output.context as AudioContext;
		if (this.players.get(id) !== entry) return;
		// 同じメディア要素にMediaElementAudioSourceNodeを二重作成しない。
		entry.source ??= context.createMediaElementSource(entry.media);
		entry.gain ??= context.createGain();
		entry.gain.gain.value = entry.volume;
		entry.source.connect(entry.gain);
		entry.gain.connect(output);
		entry.media.volume = 1;
		entry.media.muted = false;
		entry.capture = this.captureSource(playerAudioSourceId(id), entry.source);
		entry.capture.setState(!entry.media.paused && !entry.media.seeking, entry.generation);
	}

	public reconnectRenderer() {
		// メディア要素・再生位置・試聴出力を保ち、終了したworkerへの接続だけを作り直す。
		for (const [id, entry] of this.players) {
			if (!entry.capture || !entry.source) continue;
			entry.capture.dispose();
			entry.capture = null;
			entry.capture = this.captureSource(playerAudioSourceId(id), entry.source);
			entry.capture.setState(!entry.media.paused && !entry.media.seeking && !entry.media.ended, entry.generation);
		}
	}

	public getPlayerLevels(id: string) { return this.output.getLevels(playerAudioSourceId(id)); }

	public removePlayer(id: string) {
		const entry = this.players.get(id);
		if (!entry) return;
		this.players.delete(id);
		entry.cleanup();
		entry.media.pause();
		entry.capture?.dispose();
		entry.source?.disconnect();
		entry.gain?.disconnect();
		this.reset(playerAudioSourceId(id), null);
	}

	public dispose() {
		for (const id of this.players.keys()) this.removePlayer(id);
	}
}
