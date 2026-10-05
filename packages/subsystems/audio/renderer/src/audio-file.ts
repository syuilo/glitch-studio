import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { getAudioTrackError } from './audio-track-support.ts';

/** ファイルのデコードに必要な資源を開く。呼び出し側がinput.dispose()で解放する。 */
export async function openAudioFile(file: Blob) {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('No audio track.');
		const error = await getAudioTrackError(track);
		if (error) throw new Error(error);
		return { input, sink: new AudioSampleSink(track), duration: await track.computeDuration(), sampleRate: await track.getSampleRate() };
	} catch (error) {
		input.dispose();
		throw error;
	}
}

export type AudioFile = Awaited<ReturnType<typeof openAudioFile>>;
