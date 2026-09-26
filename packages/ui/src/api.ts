
import { decodeProjectFile, encodeProjectFile } from './gsproj.ts';
import type { Project } from './gsproj.ts';

const projectFilePickerOptions = {
	id: 'glitch-studio-project',
	types: [{ description: 'Glitch Studio project', accept: { 'application/octet-stream': ['.gsproj'] } }],
	excludeAcceptAllOption: true,
};

export async function saveProjectFile(project: Project, name: string, handle: FileSystemFileHandle | null = null): Promise<FileSystemFileHandle | null> {
	// ユーザー操作の権限が失効しないよう、素材のエンコードより前に保存先・書込権限を得る。
	if (handle == null) {
		try {
			handle = await window.showSaveFilePicker({
				...projectFilePickerOptions,
				suggestedName: name.toLowerCase().endsWith('.gsproj') ? name : `${name}.gsproj`,
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null;
			throw error;
		}
	} else if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
		throw new Error('Write permission was not granted. Use Save as... to choose another file.');
	}

	const data = await encodeProjectFile(project);
	const writable = await handle.createWritable();
	try {
		await writable.write(new Uint8Array(data));
		await writable.close();
	} catch (error) {
		// closeが成功するまでは元ファイルへ反映されない。失敗した書き込みを破棄する。
		await writable.abort().catch(() => {});
		throw error;
	}
	return handle;
}

export async function loadProjectFile(file?: File, handle?: FileSystemFileHandle): Promise<{ project: Project; name: string; handle?: FileSystemFileHandle } | null> {
	if (file != null) {
		return { project: decodeProjectFile(new Uint8Array(await file.arrayBuffer())), name: file.name, handle };
	}
	if (typeof window.showOpenFilePicker === 'function') {
		let selectedHandle: FileSystemFileHandle | undefined;
		try {
			[selectedHandle] = await window.showOpenFilePicker({ ...projectFilePickerOptions, multiple: false });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null;
			throw error;
		}
		if (selectedHandle == null) return null;
		return loadProjectFile(await selectedHandle.getFile(), selectedHandle);
	}
	return new Promise((resolve, reject) => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = '.gsproj';
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (file == null) { resolve(null); return; }
			try {
				const project = decodeProjectFile(new Uint8Array(await file.arrayBuffer()));
				resolve({ project, name: file.name });
			} catch (error) {
				reject(error);
			}
		}, { once: true });
		input.click();
	});
}

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
