/** PCM読み出しはmono/stereoに対応する。ファイルのメタデータ取得とは分離する。 */
export function getAudioTrackError(support: { decodable: boolean; numberOfChannels: number }): string | null {
	if (!support.decodable) return 'Audio decoding is unavailable.';
	if (support.numberOfChannels > 2) return 'Only mono and stereo audio are supported.';
	return null;
}
