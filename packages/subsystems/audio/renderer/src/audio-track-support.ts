import type { InputAudioTrack } from 'mediabunny';

/** PCM読み出しはmono/stereoに対応する。ファイルのメタデータ取得とは分離する。 */
export async function getAudioTrackError(track: InputAudioTrack): Promise<string | null> {
	if (!await track.canDecode()) return 'Audio decoding is unavailable.';
	if (await track.getNumberOfChannels() > 2) return 'Only mono and stereo audio are supported.';
	return null;
}
