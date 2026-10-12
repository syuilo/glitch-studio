import { PcmResampler, resamplingPaddingSeconds } from './pcm-resampler.ts';
import { isPcmTimeBefore } from './pcm-time.ts';
import type { AudioFile } from './audio-file.ts';
import type { AudioPcmReadOptions, DecodedPcmBlock, StereoPcm } from '@gs/subsystems_audio_shared/pcm.ts';

type DecodedWindow = { blocks: DecodedPcmBlock[]; bytes: number };

export type AudioFileReaderOptions = { maxCacheBytes?: number };

/** ソースIDの解釈は呼び出し側へ委ね、全ファイル合計のPCMキャッシュを管理する。読み取りは直列に行う。 */
export class AudioFileReader {
	private entries = new Map<string, AudioFile>();
	private windows = new Map<string, DecodedWindow>();
	private cachedBytes = 0;
	private resampler = new PcmResampler();
	private maxCacheBytes: number;

	constructor(private open: (sourceId: string) => Promise<AudioFile>, options: AudioFileReaderOptions = {}) {
		this.maxCacheBytes = options.maxCacheBytes ?? 32 * 1024 * 1024;
		if (!Number.isFinite(this.maxCacheBytes) || this.maxCacheBytes < 0) throw new Error('Invalid audio cache capacity');
	}

	private async readWindow(sourceId: string, entry: AudioFile, window: number, rate: number, signal?: AbortSignal): Promise<DecodedPcmBlock[]> {
		signal?.throwIfAborted();
		// 必要な前後の幅は出力レートにも依存する。小さい幅で読んだ窓を別のレートで再利用しない。
		const key = `${sourceId}:${rate}:${window}`;
		const cached = this.windows.get(key);
		if (cached) {
			this.windows.delete(key);
			this.windows.set(key, cached);
			return cached.blocks;
		}
		const padding = resamplingPaddingSeconds(entry.sampleRate, rate);
		const blocks: DecodedPcmBlock[] = [];
		let bytes = 0;
		for await (const block of entry.readBlocks(Math.max(0, window * 2 - padding), (window + 1) * 2 + padding)) {
			// デコーダーの待機自体は完了させ、次のブロックを要求する前に中断する。
			// 途中までの窓をキャッシュへ登録すると、次の要求で欠けたPCMを再利用してしまう。
			signal?.throwIfAborted();
			blocks.push(block);
			bytes += block.channels[0].byteLength + block.channels[1].byteLength;
		}
		signal?.throwIfAborted();
		// 単独で上限を超える窓は今回だけ使用し、既存のキャッシュを追い出して保持しない。
		if (bytes <= this.maxCacheBytes) {
			// 音声の欠落区間では空の窓もできるので、バイト数だけでなく個数にも上限を置く。
			while (this.cachedBytes + bytes > this.maxCacheBytes || this.windows.size >= 64) {
				const [oldKey, oldest] = this.windows.entries().next().value!;
				this.windows.delete(oldKey);
				this.cachedBytes -= oldest.bytes;
			}
			this.windows.set(key, { blocks, bytes });
			this.cachedBytes += bytes;
		}
		return blocks;
	}

	private async getEntry(sourceId: string): Promise<AudioFile> {
		let entry = this.entries.get(sourceId);
		if (!entry) {
			entry = await this.open(sourceId);
			this.entries.set(sourceId, entry);
		}
		return entry;
	}

	/** 素材時刻は秒。指定レートでframes個ずつの左右PCMを返し、素材外は無音にする。 */
	async read(sourceId: string, time: number, frames: number, rate: number, signal?: AbortSignal, options: AudioPcmReadOptions = {}): Promise<StereoPcm> {
		signal?.throwIfAborted();
		const playbackRate = options.playbackRate ?? 1;
		if (!Number.isFinite(playbackRate) || playbackRate === 0) throw new Error('Invalid audio playback rate');
		const entry = await this.getEntry(sourceId);
		signal?.throwIfAborted();
		const start = Math.max(0, options.sourceStartSeconds ?? 0);
		const end = Math.min(entry.durationSeconds, options.sourceEndSeconds ?? Infinity);
		// PCMは各サンプルの左端で値を持つ。逆再生の排他的な素材時刻から1素材サンプル戻すと、
		// 等速逆再生で末尾のサンプルから始まり、出力レートやチャンク境界にも依存しない。
		if (playbackRate < 0) time -= 1 / entry.sampleRate;
		const effectiveRate = rate / Math.abs(playbackRate);
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (let frame = 0; frame < frames;) {
			signal?.throwIfAborted();
			const position = time + frame * playbackRate / rate;
			if (playbackRate > 0 ? !isPcmTimeBefore(position, end) : isPcmTimeBefore(position, start)) break;
			if (isPcmTimeBefore(position, start) || !isPcmTimeBefore(position, end)) {
				frame += Math.max(1, Math.ceil((playbackRate > 0 ? start - position : position - end) * effectiveRate));
				continue;
			}
			const window = Math.floor(position / 2);
			const distance = playbackRate > 0 ? Math.min((window + 1) * 2, end) - position : position - Math.max(window * 2, start);
			const count = Math.min(frames - frame, Math.max(1, playbackRate > 0 ? Math.ceil(distance * effectiveRate) : Math.floor(distance * effectiveRate) + 1));
			const blocks = await this.readWindow(sourceId, entry, window, effectiveRate, signal);
			signal?.throwIfAborted();
			const channels = this.resampler.resample(blocks, position, count, rate, { ...options, sourceStartSeconds: start, sourceEndSeconds: end });
			output[0].set(channels[0], frame);
			output[1].set(channels[1], frame);
			frame += count;
		}
		return output;
	}

	dispose() {
		for (const entry of this.entries.values()) entry.dispose();
		this.entries.clear();
		this.windows.clear();
		this.cachedBytes = 0;
	}
}
