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

type OpenedMediaFile = {
	width: number;
	height: number;
	name: string;
	type: string;
	fileData: Blob;
	sourceFilePath: string | null;
	hash?: string;
};

type OpenMediaFileOptions = { multiple?: boolean; file?: File; includeFonts?: boolean };

export function openMediaFile(options: OpenMediaFileOptions & { multiple: true }): Promise<OpenedMediaFile[] | null>;
export function openMediaFile(options?: OpenMediaFileOptions & { multiple?: false }): Promise<OpenedMediaFile | null>;
export function openMediaFile(options: OpenMediaFileOptions): Promise<OpenedMediaFile | OpenedMediaFile[] | null>;
export function openMediaFile(options: OpenMediaFileOptions = {}): Promise<OpenedMediaFile | OpenedMediaFile[] | null> {
	return new Promise((resolve, reject) => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = options.includeFonts ? 'image/*,video/*,audio/*,.ttf,.otf,.woff,.woff2' : 'image/*,video/*,audio/*';
		input.multiple = options.multiple ?? false;
		input.addEventListener('cancel', () => resolve(null), { once: true });
		const loadFile = async (file: File): Promise<OpenedMediaFile> => {
			const fontType = options.includeFonts ? getFontFileType(file) : null;
			const type = fontType ?? file.type;
			if (fontType == null && !/^(image|audio|video)\//.test(type)) throw new Error('Unsupported media type');
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
			const source = { name: file.name, type, fileData, sourceFilePath };
			if (fontType != null) {
				// フォントは画像へデコードせず、使用するエフェクトがFontFaceとして読み込む。
				return { ...source, width: 0, height: 0 };
			}
			if (type.startsWith('audio/') || type.startsWith('video/')) return new Promise((resolve, reject) => {
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
			// デコード可能かと寸法だけを確認し、画素データは保持しない。
			// レンダラーと同じデコード経路を使い、取り込めても描画できない画像を避ける。
			const bitmap = await createImageBitmap(fileData);
			try {
				return { ...source, width: bitmap.width, height: bitmap.height };
			} finally {
				bitmap.close();
			}
		};
		const loadFiles = async (files: File[]) => {
			if (files.length === 0) return null;
			if (!options.multiple) return loadFile(files[0]);
			const results: OpenedMediaFile[] = [];
			// 大量の画像・動画を同時にデコードしてメモリを圧迫しないよう、選択順に読み込む。
			for (const file of files) results.push(await loadFile(file));
			return results;
		};
		if (options.file != null) {
			void loadFiles([options.file]).then(resolve, reject);
		} else {
			input.onchange = () => { void loadFiles(Array.from(input.files ?? [])).then(resolve, reject); };
			input.click();
		}
	});
}
