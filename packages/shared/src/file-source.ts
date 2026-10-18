/** ファイルの内容への読み取り専用の入口。URLの発行元や保存方法は利用側が所有する。 */
export type UrlFileSource = { url: string | null; size: number; error: string | null };
export type FileSource = Blob | UrlFileSource;

export function getFileSourceError(source: FileSource): string | null {
	return source instanceof Blob ? null : source.error ?? (source.url == null ? 'File is unavailable.' : null);
}

/** BlobのURLは呼び出し側がrevokeする。URL入力には新しい所有権は発生しない。 */
export function getFileSourceUrl(source: FileSource): string {
	if (source instanceof Blob) return URL.createObjectURL(source);
	const error = getFileSourceError(source);
	if (error != null) throw new Error(error);
	return source.url!;
}

export function releaseFileSourceUrl(source: FileSource, url: string) {
	if (source instanceof Blob) URL.revokeObjectURL(url);
}

export async function readFileSource(source: FileSource): Promise<Blob> {
	if (source instanceof Blob) return source;
	const response = await fetch(getFileSourceUrl(source));
	if (!response.ok) throw new Error(`Could not read file (${response.status}).`);
	return response.blob();
}
