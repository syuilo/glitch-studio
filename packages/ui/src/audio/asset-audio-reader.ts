import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import type { Asset } from '@glitch/shared/types.ts';
import type { StereoPcm } from '@glitch/audio-renderer/timeline-audio-renderer.ts';

type DecodedBlock = { time: number; rate: number; channels: StereoPcm };

export async function openAssetAudio(asset: Asset) {
	const input = new Input({ source: new BlobSource(asset.fileData), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error(`${asset.name}: No audio track.`);
		if (!await track.canDecode()) throw new Error(`${asset.name}: Audio decoding is unavailable.`);
		if (track.numberOfChannels > 2) throw new Error(`${asset.name}: Only mono and stereo audio are supported.`);
		return { input, sink: new AudioSampleSink(track), duration: await track.computeDuration() };
	} catch (error) {
		input.dispose();
		throw error;
	}
}

/** 素材全体は展開せず、素材ごとに直近の2秒窓だけ保持する。 */
export class AssetAudioReader {
	private entries = new Map<string, Awaited<ReturnType<typeof openAssetAudio>> & { window: number; blocks: DecodedBlock[] }>();
	constructor(private assets: readonly Asset[]) {}

	async read(assetId: string, time: number, frames: number, rate: number): Promise<StereoPcm> {
		let entry = this.entries.get(assetId);
		if (!entry) {
			const asset = this.assets.find(asset => asset.id === assetId);
			if (!asset) throw new Error(`Audio asset not found: ${assetId}`);
			entry = { ...await openAssetAudio(asset), window: -1, blocks: [] };
			this.entries.set(assetId, entry);
		}
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (let frame = 0; frame < frames; frame++) {
			const position = time + frame / rate;
			if (position < 0 || position >= entry.duration) continue;
			const window = Math.floor(position / 2);
			if (entry.window !== window) {
				const blocks: DecodedBlock[] = [];
				// 補間の隣接サンプルも読み込む。窓境界で0へ補間してクリック音を作らない。
				for await (const sample of entry.sink.samples(Math.max(0, window * 2 - 0.01), (window + 1) * 2 + 0.01)) {
					try {
						const left = new Float32Array(sample.numberOfFrames);
						const right = new Float32Array(sample.numberOfFrames);
						sample.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
						if (sample.numberOfChannels > 1) sample.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
						else right.set(left);
						blocks.push({ time: sample.timestamp, rate: sample.sampleRate, channels: [left, right] });
					} finally { sample.close(); }
				}
				entry.blocks = blocks;
				entry.window = window;
			}
			const index = entry.blocks.findIndex(block => position >= block.time && position < block.time + block.channels[0].length / block.rate);
			if (index < 0) continue;
			const block = entry.blocks[index];
			const x = (position - block.time) * block.rate;
			// 秒→サンプル位置の浮動小数点誤差で末尾を1サンプル越えないようにする。
			const low = Math.min(Math.floor(x), block.channels[0].length - 1);
			const fraction = x - low;
			for (let channel = 0; channel < 2; channel++) {
				const a = block.channels[channel][low];
				const next = entry.blocks[index + 1];
				const contiguous = next && Math.abs(next.time - (block.time + block.channels[0].length / block.rate)) < 0.5 / block.rate;
				const b = block.channels[channel][low + 1] ?? (contiguous ? next.channels[channel][0] : 0);
				output[channel][frame] = a * (1 - fraction) + b * fraction;
			}
		}
		return output;
	}

	dispose() {
		for (const entry of this.entries.values()) entry.input.dispose();
		this.entries.clear();
	}
}
