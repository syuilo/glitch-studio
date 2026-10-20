import path from 'node:path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const mediaExtensions = [
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'apng', 'tif', 'tiff',
	'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', 'ogv',
	'mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aif', 'aiff', 'weba',
];

export function registerMediaFileIpc(ipcMain, dialog, directories, getTrustedMainWindow, fetchFile) {
	ipcMain.handle('desktop:choose-media-files', async (event, options) => {
		const parent = getTrustedMainWindow(event);
		const { multiple, includeFonts, allowAnyFile } = options ?? {};
		if ([multiple, includeFonts, allowAnyFile].some(value => typeof value !== 'boolean')) throw new Error('Invalid media selection options');
		const extensions = includeFonts ? [...mediaExtensions, 'ttf', 'otf', 'woff', 'woff2'] : mediaExtensions;
		const result = await dialog.showOpenDialog(parent, {
			defaultPath: await directories.get('media-open'),
			properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
			filters: allowAnyFile ? [] : [{ name: 'Media files', extensions }, { name: 'All files', extensions: ['*'] }],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		const paths = multiple ? result.filePaths : result.filePaths.slice(0, 1);
		await directories.remember('media-open', path.dirname(paths[0]));
		return Promise.all(paths.map(async filePath => {
			const file = { name: path.basename(filePath), sourceFilePath: filePath };
			try {
				// Chromiumと同じMIME判定を使い、拡張子の独自推測や原本全体のコピーを避ける。
				const response = await fetchFile(pathToFileURL(filePath).href, { method: 'HEAD' });
				if (!response.ok) throw new Error(`Could not inspect media file (${response.status}).`);
				return { ...file, type: response.headers.get('Content-Type') ?? '', size: (await fs.stat(filePath)).size, error: null };
			} catch (error) {
				// 選択直後に消えた原本などは、取り込み側で個別に報告して他の素材を続ける。
				return { ...file, type: '', size: 0, error: error instanceof Error ? error.message : String(error) };
			}
		}));
	});
}
