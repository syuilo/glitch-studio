import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { getAudioTrackError } from './audio-track-support.ts';
import type { DecodedPcmBlock } from '@gs/subsystems_audio_shared/pcm.ts';

/** デコーダー資源は隠蔽し、所有権を渡すPCMブロックだけを公開する。読み取りは直列に行う。 */
export type AudioFile = {
	/** 素材の共通原点から音声終端までの有限・正数の秒数。 */
	readonly durationSeconds: number;
	readonly sampleRate: number;
	/** 指定区間にかかるブロックを時刻順に返す。デコード境界により区間外のサンプルも含み得る。 */
	readBlocks(startSeconds: number, endSeconds: number): AsyncIterable<DecodedPcmBlock>;
	dispose(): void;
};

/** 成功時は呼び出し側がAudioFile.dispose()で解放する。失敗時はここで解放する。 */
export async function openAudioFile(file: Blob): Promise<AudioFile> {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('No audio track.');
		const error = getAudioTrackError({ decodable: await track.canDecode(), numberOfChannels: await track.getNumberOfChannels() });
		if (error) throw new Error(error);
		const durationSeconds = await track.computeDuration();
		// 素材の妥当性は開く境界で保証し、ミックスやチャンク読み出しのたびに検証しない。
		if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Audio has no finite duration.');
		const sampleRate = await track.getSampleRate();
		const sink = new AudioSampleSink(track);
		return {
			durationSeconds, sampleRate,
			async *readBlocks(startSeconds, endSeconds) {
				for await (const sample of sink.samples(startSeconds, endSeconds)) {
					let block: DecodedPcmBlock;
					try {
						const left = new Float32Array(sample.numberOfFrames);
						const right = new Float32Array(sample.numberOfFrames);
						sample.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
						if (sample.numberOfChannels > 1) sample.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
						else right.set(left);
						block = { time: sample.timestamp, rate: sample.sampleRate, channels: [left, right] };
					} finally { sample.close(); }
					// 呼び出し側が反復を中断してもデコーダーのサンプルを保持しないよう、返す前に解放する。
					yield block;
				}
			},
			dispose() { input.dispose(); },
		};
	} catch (error) {
		input.dispose();
		throw error;
	}
}
