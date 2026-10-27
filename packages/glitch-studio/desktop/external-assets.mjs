import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { URL } from 'node:url';

/* global Response */

/** 選択・プロジェクト読込で登録した原本だけを配信し、URLから任意の実パスを指定させない。 */
export class ExternalAssetFiles {
	#files = new Map();
	#keys = new Map();

	hasUrl(url) { return this.#files.has(new URL(url).pathname.slice(1)); }
	clear() { this.#files.clear(); this.#keys.clear(); }

	async resolve(filePath, reload = false) {
		if (!path.isAbsolute(filePath)) throw new Error('An absolute asset path is required.');
		try {
			const file = await fs.open(filePath, 'r');
			let stat;
			try { stat = await file.stat(); } finally { await file.close(); }
			if (!stat.isFile()) throw new Error('The asset is not a regular file.');
			let id = this.#keys.get(filePath);
			if (id == null || reload) {
				id = randomUUID();
				this.#files.set(id, filePath);
				this.#keys.set(filePath, id);
			}
			return { url: `app://external-assets/${id}`, size: stat.size, error: null };
		} catch (error) {
			return { url: null, size: 0, error: `Could not read asset "${filePath}": ${error.message}` };
		}
	}

	async respond(request, origin) {
		const filePath = this.#files.get(new URL(request.url).pathname.slice(1));
		const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Range',
			'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
			'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
		if (request.method === 'OPTIONS') return new Response(null, { headers });
		if (filePath == null || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404, headers });
		let file;
		try {
			file = await fs.open(filePath, 'r');
			const { size } = await file.stat();
			const range = request.headers.get('Range');
			let start = 0;
			let end = size - 1;
			if (range != null) {
				headers['Content-Range'] = `bytes */${size}`;
				const match = /^bytes=(\d*)-(\d*)$/.exec(range);
				if (match == null || (match[1] === '' && match[2] === '')) throw new RangeError();
				if (match[1] === '') start = Math.max(0, size - Number(match[2]));
				else { start = Number(match[1]); if (match[2] !== '') end = Math.min(end, Number(match[2])); }
				if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw new RangeError();
			}
			headers['Content-Length'] = String(Math.max(0, end - start + 1));
			if (range != null) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
			if (request.method === 'HEAD' || size === 0) {
				await file.close(); file = null;
				return new Response(null, { status: range == null ? 200 : 206, headers });
			}
			// FileHandleからstreamへ所有権を移し、キャンセル時もfdを解放する。
			const stream = file.createReadStream({ start, end, autoClose: true });
			file = null;
			return new Response(Readable.toWeb(stream, { strategy: {
				highWaterMark: 256 * 1024, size: chunk => chunk.byteLength,
			} }), { status: range == null ? 200 : 206, headers });
		} catch (error) {
			await file?.close().catch(() => {});
			return new Response(null, { status: error instanceof RangeError ? 416 : 404, headers });
		}
	}
}

export function projectAssetPath(filePath, projectPath, storing) {
	if (filePath == null || projectPath == null) return filePath;
	const directory = path.dirname(projectPath);
	if (!storing) return path.resolve(directory, filePath);
	const relative = path.relative(directory, filePath);
	// 隣接名のディレクトリや別ドライブを、文字列の前方一致で子と判定しない。
	return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
		? relative.split(path.sep).join('/') : filePath;
}

export function registerExternalAssetIpc(ipcMain, dialog, files, projectFiles, getTrustedMainWindow) {
	const exports = new Map();
	let disposed = false;
	ipcMain.handle('desktop:resolve-external-asset', (event, filePath, reload) => {
		getTrustedMainWindow(event);
		return files.resolve(filePath, reload);
	});
	ipcMain.handle('desktop:asset-project-paths', (event, paths, projectId, storing) => {
		getTrustedMainWindow(event);
		const projectPath = projectId == null ? null : projectFiles.getPath(projectId);
		return paths.map(filePath => projectAssetPath(filePath, projectPath, storing));
	});
	ipcMain.handle('desktop:choose-asset-file', async (event, previousPath) => {
		const parent = getTrustedMainWindow(event);
		const result = await dialog.showOpenDialog(parent, { properties: ['openFile'],
			...(previousPath == null ? {} : { defaultPath: path.dirname(previousPath) }) });
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	});
	ipcMain.handle('desktop:begin-asset-export', async (event, name) => {
		const parent = getTrustedMainWindow(event);
		if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('Invalid asset name.');
		const selected = await dialog.showSaveDialog(parent, { defaultPath: name });
		if (selected.canceled || selected.filePath == null) return null;
		if (disposed) throw new Error('The editor window has been closed.');
		const id = randomUUID();
		const temporary = path.join(path.dirname(selected.filePath), `.glitch-studio-asset-${id}.tmp`);
		const file = await fs.open(temporary, 'wx');
		// ファイル作成を待つ間に画面が閉じられても、後から一時ファイルを残さない。
		if (disposed) {
			await file.close(); await fs.unlink(temporary).catch(() => {});
			throw new Error('The editor window has been closed.');
		}
		exports.set(id, { destination: selected.filePath, temporary, file });
		return id;
	});
	ipcMain.handle('desktop:write-asset-export', async (event, id, chunk) => {
		getTrustedMainWindow(event);
		const output = exports.get(id);
		if (output == null) throw new Error('Unknown asset export.');
		if (chunk != null) {
			if (!(chunk instanceof Uint8Array) || chunk.byteLength > 1024 * 1024) throw new Error('Invalid asset export chunk.');
			await output.file.writeFile(chunk);
			return;
		}
		exports.delete(id);
		try {
			await output.file.sync();
			await output.file.close();
			await fs.rename(output.temporary, output.destination);
		} finally { await output.file.close().catch(() => {}); await fs.unlink(output.temporary).catch(() => {}); }
	});
	ipcMain.handle('desktop:abort-asset-export', async (event, id) => {
		getTrustedMainWindow(event);
		const output = exports.get(id);
		exports.delete(id);
		if (output != null) { await output.file.close().catch(() => {}); await fs.unlink(output.temporary).catch(() => {}); }
	});
	return async () => {
		disposed = true;
		const outputs = [...exports.values()];
		exports.clear();
		for (const output of outputs) {
			await output.file.close().catch(() => {});
			await fs.unlink(output.temporary).catch(() => {});
		}
	};
}
