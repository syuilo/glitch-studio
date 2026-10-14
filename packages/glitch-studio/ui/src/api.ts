import { generateVideoThumbnails } from './utility/video-thumbnails.ts';
import type { AssetThumbnailSequence } from './asset-thumbnail.ts';

// OSによってフォントのMIMEが空やapplication/*になるため、取り込み時に正規化する。
// Asset名は後から変更できるので、取り込み後の判定には拡張子を使わない。
function getFontFileType(file: File): string | null {
	const mimeTypes: Record<string, string> = {
		'font/ttf': 'font/ttf',
		'font/otf': 'font/otf',
		'font/woff': 'font/woff',
		'font/woff2': 'font/woff2',
		'application/x-font-ttf': 'font/ttf',
		'application/x-font-truetype': 'font/ttf',
		'application/x-font-opentype': 'font/otf',
		'application/vnd.ms-opentype': 'font/otf',
		'application/font-woff': 'font/woff',
		'application/x-font-woff': 'font/woff',
	};
	const extensions: Record<string, string> = {
		ttf: 'font/ttf',
		otf: 'font/otf',
		woff: 'font/woff',
		woff2: 'font/woff2',
	};
	return mimeTypes[file.type.toLowerCase()] ?? extensions[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export type OpenedMediaFile = {
	width: number;
	height: number;
	name: string;
	type: string;
	fileData: Blob;
	sourceFilePath: string | null;
	thumbnailSequence: AssetThumbnailSequence | null;
	hash?: string;
};

export type MediaFileReadProgress = {
	file: File;
	fileIndex: number;
	completedFiles: number;
	totalFiles: number;
	fileProgress: number | null;
};

export type OpenMediaFileOptions = {
	multiple?: boolean;
	file?: File;
	files?: readonly File[];
	includeFonts?: boolean;
	/** Assetsへの取り込みでは種類を制限せず、メディア以外は原本だけ保存する。 */
	allowAnyFile?: boolean;
	onThumbnailProgress?: (value: number) => void;
	onReadProgress?: (progress: MediaFileReadProgress) => void;
	/** 設定された場合は失敗を通知し、残りのファイルを続ける。未設定ではエラーを返す。 */
	onFileError?: (file: File, error: unknown) => void;
};

/** 選択と読み込みを分け、選択ダイアログが閉じてから取り込み中の操作を止める。 */
export function selectMediaFiles(options: OpenMediaFileOptions = {}): Promise<File[] | null> {
	if (options.files != null) return Promise.resolve(Array.from(options.files));
	if (options.file != null) return Promise.resolve([options.file]);
	return new Promise(resolve => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = options.allowAnyFile === true ? '' : options.includeFonts === true ? 'image/*,video/*,audio/*,.ttf,.otf,.woff,.woff2' : 'image/*,video/*,audio/*';
		input.multiple = options.multiple ?? false;
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.onchange = () => resolve(Array.from(input.files ?? []));
		input.click();
	});
}

export function openMediaFile(options: OpenMediaFileOptions & { multiple: true }): Promise<OpenedMediaFile[] | null>;
export function openMediaFile(options?: OpenMediaFileOptions & { multiple?: false }): Promise<OpenedMediaFile | null>;
export function openMediaFile(options: OpenMediaFileOptions): Promise<OpenedMediaFile | OpenedMediaFile[] | null>;
export async function openMediaFile(options: OpenMediaFileOptions = {}): Promise<OpenedMediaFile | OpenedMediaFile[] | null> {
	const loadFile = async (file: File, onThumbnailProgress: (value: number) => void): Promise<OpenedMediaFile> => {
		const fontType = options.includeFonts === true || options.allowAnyFile === true ? getFontFileType(file) : null;
		const type = fontType ?? (file.type === '' ? 'application/octet-stream' : file.type);
		const isMedia = /^(image|audio|video)\//.test(type);
		if (options.allowAnyFile !== true && fontType == null && !isMedia) throw new Error('Unsupported media type');
		// パスは元のFileからだけ取得できる。ブラウザのfakepathや相対パスは原本の場所を示さない。
		// ElectronでもJSで生成したFileにはパスがないため、空文字列は未取得として扱う。
		const sourceFilePath = window.desktop?.getPathForFile(file) || null;
		// Fileやそのsliceを保持しただけでは、元ファイルの変更・削除後に読み出せなくなる。
		// 原本のバイト列を取り込み時にコピーし、寸法取得・プレビュー・保存で同じ内容を使う。
		// new Blob([file])も元ファイルを参照するため、必ずarrayBufferを経由する。
		let fileData: Blob;
		try {
			fileData = new Blob([await file.arrayBuffer()], { type });
		} catch (cause) {
			throw new Error(`Could not read "${file.name}". Select the source file again.`, { cause });
		}
		const source = { name: file.name, type, fileData, sourceFilePath, thumbnailSequence: null };
		if (fontType != null || !isMedia) {
			// 汎用ファイルはデコードの対象にせず、プロジェクトに原本を保存する。
			// フォントもここではデコードせず、使用するエフェクトがFontFaceとして読み込む。
			return { ...source, width: 0, height: 0 };
		}
		if (type.startsWith('audio/') || type.startsWith('video/')) {
			const result = await new Promise<OpenedMediaFile>((resolve, reject) => {
				const media = window.document.createElement(type.startsWith('audio/') ? 'audio' : 'video');
				const url = URL.createObjectURL(fileData);
				const cleanup = () => {
					media.onloadedmetadata = null;
					media.onerror = null;
					media.removeAttribute('src');
					media.load();
					URL.revokeObjectURL(url);
				};
				media.preload = 'metadata';
				media.onloadedmetadata = () => {
					resolve({
						...source,
						width: media instanceof HTMLVideoElement ? media.videoWidth : 0,
						height: media instanceof HTMLVideoElement ? media.videoHeight : 0,
					});
				cleanup();
			};
			media.onerror = () => { const error = media.error; cleanup(); reject(error ?? new Error('Could not decode media')); };
			media.src = url;
			});
			if (type.startsWith('video/')) {
				try {
					result.thumbnailSequence = await generateVideoThumbnails(fileData, onThumbnailProgress);
				} catch (error) {
					// HTMLの動画再生とWebCodecsの対応形式は異なる。サムネイルだけの失敗で素材を失わない。
					console.warn(`Could not generate thumbnails for "${file.name}".`, error);
				} finally {
					onThumbnailProgress(1);
				}
			}
			return result;
		}
		// デコード可能かと寸法だけを確認し、画素データは保持しない。
		// レンダラーと同じデコード経路を使い、取り込めても描画できない画像を避ける。
		const bitmap = await createImageBitmap(fileData);
		try {
			return { ...source, width: bitmap.width, height: bitmap.height };
		} finally {
			bitmap.close();
		}
	};
	const files = await selectMediaFiles(options);
	if (files == null || files.length === 0) return null;
	const results: OpenedMediaFile[] = [];
	// 大量の画像・動画を同時にデコードしてメモリを圧迫しないよう、選択順に読み込む。
	const selectedFiles = options.multiple === true ? files : files.slice(0, 1);
	for (const [index, file] of selectedFiles.entries()) {
		const report = (fileProgress: number | null, completedFiles = index) => options.onReadProgress?.({
			file, fileIndex: index, completedFiles, totalFiles: selectedFiles.length, fileProgress,
		});
		report(null);
		try {
			results.push(await loadFile(file, value => {
				options.onThumbnailProgress?.((index + value) / selectedFiles.length);
				report(value);
			}));
		} catch (error) {
			if (options.onFileError == null) throw error;
			options.onFileError(file, error);
		}
		report(1, index + 1);
	}
	return options.multiple === true ? results : results[0] ?? null;
}
