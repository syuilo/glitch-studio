import { saveProjectFile } from './gsproj.ts';
import type { ProjectBackupDirectory } from './project-backups.ts';

export async function selectProjectBackupFolder(handle: FileSystemFileHandle): Promise<FileSystemDirectoryHandle> {
	const directory = await window.showDirectoryPicker({ id: 'glitch-studio-project', mode: 'readwrite', startIn: handle });
	const candidate = await directory.getFileHandle(handle.name);
	if (!await candidate.isSameEntry(handle)) throw new Error('Choose the folder containing the current project file.');
	return directory;
}

export function browserProjectBackupDirectory(directory: FileSystemDirectoryHandle): ProjectBackupDirectory {
	return {
		hasPermission: async () => await directory.queryPermission({ mode: 'readwrite' }) === 'granted',
		async list() {
			const names: string[] = [];
			for await (const [name, handle] of directory.entries()) if (handle.kind === 'file') names.push(name);
			return names;
		},
		async create(name, data) {
			// 同じオリジンの別タブも含め、存在確認と作成の間に同名バックアップを作らせない。
			return navigator.locks.request(`glitch-studio-backup:${name}`, async () => {
				try {
					await directory.getFileHandle(name);
					return false;
				} catch (error) {
					if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
				}
				const handle = await directory.getFileHandle(name, { create: true });
				try {
					await saveProjectFile(data, handle);
				} catch (error) {
					await directory.removeEntry(name).catch(() => {});
					throw error;
				}
				return true;
			});
		},
		remove: name => directory.removeEntry(name),
	};
}

export function desktopProjectBackupDirectory(id: string): ProjectBackupDirectory {
	const desktop = window.desktop!;
	return {
		hasPermission: async () => true,
		list: () => desktop.listProjectBackups(id),
		create: (name, data) => desktop.writeProjectBackup(id, name, data),
		remove: name => desktop.removeProjectBackup(id, name),
	};
}
