import { ALL_FORMATS, BlobSource, Input, UrlSource } from 'mediabunny';
import { getFileSourceUrl } from '../file-source.ts';
import type { FileSource } from '../file-source.ts';

/** URL入力も原本全体をBlobに変換せず、上限付きの範囲読み取りでデコーダーへ渡す。 */
export function createMediaInput(source: FileSource) {
	return new Input({ formats: ALL_FORMATS, source: source instanceof Blob ? new BlobSource(source)
		: new UrlSource(getFileSourceUrl(source), { maxCacheSize: 8 * 1024 * 1024 }) });
}
