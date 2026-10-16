import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

/** 実パスはmainだけで保持する。rendererへは履歴IDと表示情報だけを返す。 */
export class RecentProjects {
	constructor(directory) { this.directory = directory; }

	entryPath(id) {
		if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid recent project ID');
		return path.join(this.directory, `${id}.json`);
	}

	async read(id) { return JSON.parse(await fs.readFile(this.entryPath(id), 'utf8')); }

	async list() {
		let names;
		try { names = await fs.readdir(this.directory); } catch (error) {
			if (error.code === 'ENOENT') return [];
			throw error;
		}
		const entries = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
			try { return await this.read(name.slice(0, -5)); } catch (error) {
				// 他のウィンドウによる履歴削除と競合しても、残りの項目は表示する。
				if (error.code === 'ENOENT') return null;
				throw error;
			}
		}));
		return entries.filter(entry => entry != null).sort((first, second) => second.lastUsedAt - first.lastUsedAt);
	}

	async remember(filePath, name) {
		const normalized = path.normalize(filePath);
		const identity = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
		const id = createHash('sha256').update(identity).digest('hex');
		const entry = { id, name, fileName: path.basename(normalized), lastUsedAt: Date.now(), filePath: normalized };
		await fs.mkdir(this.directory, { recursive: true });
		const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
		try {
			// ファイル単位で置換し、別プロセスで記録した他の作品を古い一覧で上書きしない。
			await fs.writeFile(temporary, JSON.stringify(entry), { flag: 'wx' });
			await fs.rename(temporary, this.entryPath(id));
		} finally {
			await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
		}
		const entries = await this.list();
		for (const previous of entries.slice(20)) await this.remove(previous.id);
	}

	async remove(id) {
		try { await fs.unlink(this.entryPath(id)); } catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}

	async clear() {
		for (const entry of await this.list()) await this.remove(entry.id);
	}
}

export function registerRecentProjectsIpc(ipcMain, recentProjects, projectFiles, getTrustedMainWindow) {
	ipcMain.handle('desktop:list-recent-projects', async event => {
		getTrustedMainWindow(event);
		return (await recentProjects.list()).slice(0, 20).map(({ filePath: _filePath, ...entry }) => entry);
	});
	ipcMain.handle('desktop:remember-recent-project', async (event, id, name) => {
		getTrustedMainWindow(event);
		if (typeof name !== 'string') throw new Error('Invalid project name');
		await recentProjects.remember(projectFiles.getPath(id), name);
	});
	ipcMain.handle('desktop:resolve-recent-project', async (event, id) => {
		getTrustedMainWindow(event);
		const entry = await recentProjects.read(id);
		return projectFiles.describe(projectFiles.register(entry.filePath));
	});
	ipcMain.handle('desktop:remove-recent-project', async (event, id) => {
		getTrustedMainWindow(event);
		await recentProjects.remove(id);
	});
	ipcMain.handle('desktop:clear-recent-projects', async event => {
		getTrustedMainWindow(event);
		await recentProjects.clear();
	});
}
