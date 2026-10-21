import { openMediaFile } from './api.ts';
import type { ProjectAsset } from './Project.ts';
import { readFileSource } from '@gs/shared/file-source.ts';

const resolutions = new WeakMap<ProjectAsset, number>();

/** 可読性の再確認はメタデータやサムネイルをリロードしない。Undo後も現時点の参照先を解決する。 */
export async function resolveExternalAssets(assets: readonly ProjectAsset[]): Promise<boolean> {
	let changed = false;
	await Promise.all(assets.filter(asset => asset.isExternalReference === true).map(async asset => {
		const path = asset.sourceFilePath;
		const generation = (resolutions.get(asset) ?? 0) + 1;
		resolutions.set(asset, generation);
		let source;
		try {
			source = window.desktop?.resolveExternalAsset != null && path != null
				? await window.desktop.resolveExternalAsset(path)
				: { url: null, size: 0, error: window.desktop == null ? 'External references require the Electron app.' : 'External reference has no file path.' };
		} catch (error) { source = { url: null, size: 0, error: error instanceof Error ? error.message : String(error) }; }
		if (resolutions.get(asset) !== generation || asset.sourceFilePath !== path || !asset.isExternalReference) return;
		if (asset.fileData instanceof Blob || asset.fileData.url !== source.url || asset.fileData.error !== source.error) {
			asset.fileData = source;
			changed = true;
		}
	}));
	return changed;
}

/** パスから再選択・リロードする場合にも、通常の取り込みと同じMIME正規化・検査を通す。 */
export async function openExternalAsset(filePath: string, type: string, isExternalReference = true) {
	const name = filePath.split(/[\\/]/).at(-1)!;
	const extension = name.split('.').at(-1)!.toLowerCase();
	const mimeTypes: Record<string, string> = {
		mp4: 'video/mp4',
		m4v: 'video/mp4',
		mov: 'video/quicktime',
		webm: 'video/webm',
		mkv: 'video/x-matroska',
		avi: 'video/x-msvideo',
		mp3: 'audio/mpeg',
		wav: 'audio/wav',
		flac: 'audio/flac',
		ogg: 'audio/ogg',
		opus: 'audio/ogg',
		m4a: 'audio/mp4',
		aac: 'audio/aac',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		avif: 'image/avif',
		bmp: 'image/bmp',
		svg: 'image/svg+xml',
		txt: 'text/plain',
		json: 'application/json',
		zip: 'application/zip',
		pdf: 'application/pdf',
	};
	type = mimeTypes[extension] ?? type;
	if (window.desktop?.resolveExternalAsset == null) throw new Error('External references require the Electron app.');
	// 外部参照ではこの空Fileのバイト列を使わない。埋め込み変換時だけ原本を取得する。
	let file = new File([], name, { type });
	if (!isExternalReference) {
		const source = await window.desktop.resolveExternalAsset(filePath);
		file = new File([await readFileSource(source)], name, { type });
	}
	return openMediaFile({
		file,
		sourceFilePath: filePath,
		isExternalReference,
		includeFonts: true,
		allowAnyFile: true,
	});
}
