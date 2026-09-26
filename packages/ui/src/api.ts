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

export function openMediaFile(options: { multiple?: boolean; file?: File; includeFonts?: boolean } = {}): Promise<{
	width: number;
	height: number;
	name: string;
	type: string;
	fileData: Blob;
	hash?: string;
} | null> {
	return new Promise((resolve, reject) => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = options.includeFonts ? 'image/*,video/*,audio/*,.ttf,.otf,.woff,.woff2' : 'image/*,video/*,audio/*';
		input.multiple = options.multiple ?? false;
		input.addEventListener('cancel', () => resolve(null), { once: true });
		const loadFile = (file: File | undefined) => {
			if (file == null) { resolve(null); return; }
			const fontType = options.includeFonts ? getFontFileType(file) : null;
			if (fontType != null) {
				// フォントは画像へデコードせず、使用するエフェクトがFontFaceとして読み込む。
				resolve({
					width: 0,
					height: 0,
					name: file.name,
					type: fontType,
					fileData: file.slice(0, file.size, fontType),
				});
				return;
			}
			if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
				const media = window.document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
				const url = URL.createObjectURL(file);
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
						width: media instanceof HTMLVideoElement ? media.videoWidth : 0,
						height: media instanceof HTMLVideoElement ? media.videoHeight : 0,
						name: file.name,
						type: file.type,
						fileData: file,
					});
					cleanup();
				};
				media.onerror = () => { const error = media.error; cleanup(); reject(error ?? new Error('Could not decode media')); };
				media.src = url;
				return;
			}
			if (!file.type.startsWith('image/')) { reject(new Error('Unsupported media type')); return; }
			// デコード可能かと寸法だけを確認し、画素データは保持しない。
			// レンダラーと同じデコード経路を使い、取り込めても描画できない画像を避ける。
			void createImageBitmap(file).then(bitmap => {
				try {
					resolve({ width: bitmap.width, height: bitmap.height, name: file.name, type: file.type, fileData: file });
				} finally {
					bitmap.close();
				}
			}, reject);
		};
		if (options.file != null) {
			loadFile(options.file);
		} else {
			input.onchange = () => loadFile(input.files?.[0]);
			input.click();
		}
	});
}
