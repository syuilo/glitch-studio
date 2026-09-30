import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { readVideoMetadata } from '@glitch/shared/media/video-metadata.ts';
import { PcmResampler, resamplingPaddingSeconds } from '@glitch/audio-renderer/pcm-resampler.ts';
import type { Asset } from '@glitch/shared/types.ts';
import type { DecodedPcmBlock, StereoPcm } from '@glitch/audio-renderer/pcm.ts';

type DecodedWindow = { blocks: DecodedPcmBlock[]; bytes: number };
type AssetAudio = Awaited<ReturnType<typeof openAssetAudio>>;

export async function openAssetAudio(asset: Asset) {
	const input = new Input({ source: new BlobSource(asset.fileData), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error(`${asset.name}: No audio track.`);
		if (!await track.canDecode()) throw new Error(`${asset.name}: Audio decoding is unavailable.`);
		if (track.numberOfChannels > 2) throw new Error(`${asset.name}: Only mono and stereo audio are supported.`);
		return { input, sink: new AudioSampleSink(track), duration: await track.computeDuration(), sampleRate: await track.getSampleRate() };
	} catch (error) {
		input.dispose();
		throw error;
	}
}

/** 複数の再生位置を共有できる、全素材合計の容量上限付きLRUキャッシュ。読み取りは直列に行う。 */
export class AssetAudioReader {
	private entries = new Map<string, AssetAudio>();
	private windows = new Map<string, DecodedWindow>();
	private cachedBytes = 0;
	private resampler = new PcmResampler();
	private maxCacheBytes: number;
	private open: typeof openAssetAudio;

	constructor(private assets: readonly Asset[], options: { maxCacheBytes?: number; open?: typeof openAssetAudio } = {}) {
		this.maxCacheBytes = options.maxCacheBytes ?? 32 * 1024 * 1024;
		if (!Number.isFinite(this.maxCacheBytes) || this.maxCacheBytes < 0) throw new Error('Invalid audio cache capacity');
		this.open = options.open ?? openAssetAudio;
	}

	private async readWindow(assetId: string, entry: AssetAudio, window: number, rate: number): Promise<DecodedPcmBlock[]> {
		// 必要な前後の幅は出力レートにも依存する。小さい幅で読んだ窓を別のレートで再利用しない。
		const key = `${assetId}:${rate}:${window}`;
		const cached = this.windows.get(key);
		if (cached) {
			this.windows.delete(key);
			this.windows.set(key, cached);
			return cached.blocks;
		}
		const padding = resamplingPaddingSeconds(entry.sampleRate, rate);
		const blocks: DecodedPcmBlock[] = [];
		let bytes = 0;
		for await (const sample of entry.sink.samples(Math.max(0, window * 2 - padding), (window + 1) * 2 + padding)) {
			try {
				const left = new Float32Array(sample.numberOfFrames);
				const right = new Float32Array(sample.numberOfFrames);
				sample.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
				if (sample.numberOfChannels > 1) sample.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
				else right.set(left);
				blocks.push({ time: sample.timestamp, rate: sample.sampleRate, channels: [left, right] });
				bytes += left.byteLength + right.byteLength;
			} finally { sample.close(); }
		}
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

	private async getEntry(assetId: string): Promise<AssetAudio> {
		let entry = this.entries.get(assetId);
		if (!entry) {
			const asset = this.assets.find(asset => asset.id === assetId);
			if (!asset) throw new Error(`Audio asset not found: ${assetId}`);
			entry = await this.open(asset);
			this.entries.set(assetId, entry);
		}
		return entry;
	}

	async getDurationMs(assetId: string, basis: 'audio' | 'media' = 'audio'): Promise<number> {
		if (basis === 'media') {
			const asset = this.assets.find(asset => asset.id === assetId);
			if (!asset) throw new Error('Video asset not found: ' + assetId);
			return (await readVideoMetadata(asset.fileData)).durationMs;
		}
		return (await this.getEntry(assetId)).duration * 1000;
	}

	async read(assetId: string, time: number, frames: number, rate: number): Promise<StereoPcm> {
		const entry = await this.getEntry(assetId);
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (let frame = 0; frame < frames;) {
			const position = time + frame / rate;
			if (position >= entry.duration) break;
			if (position < 0) { frame += Math.max(1, Math.ceil(-position * rate)); continue; }
			const window = Math.floor(position / 2);
			const count = Math.min(frames - frame, Math.max(1, Math.ceil((Math.min((window + 1) * 2, entry.duration) - position) * rate)));
			const blocks = await this.readWindow(assetId, entry, window, rate);
			const channels = this.resampler.resample(blocks, position, count, rate);
			output[0].set(channels[0], frame);
			output[1].set(channels[1], frame);
			frame += count;
		}
		return output;
	}

	dispose() {
		for (const entry of this.entries.values()) entry.input.dispose();
		this.entries.clear();
		this.windows.clear();
		this.cachedBytes = 0;
	}
}
