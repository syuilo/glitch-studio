import { writeFileSystemFile } from './utility/write-file-system-file.ts';
import type { ProjectBackupDirectory, SaveBackupWriter } from './project-backups.ts';
import type { ProjectFileHandle } from './gsproj.ts';

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
			if (data.byteLength === 0) throw new Error('The backup contains no save data.');
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
					await writeFileSystemFile(handle, data);
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

export function projectSaveBackupWriter(handle: ProjectFileHandle, directory: ProjectBackupDirectory): SaveBackupWriter {
	let previous: Uint8Array | null = null;
	return async name => {
		// 動画入りの旧プロジェクトをIPCで往復させず、登録された実ファイルをmain側でコピーする。
		if (handle.kind === 'desktop-project-file') return window.desktop!.copyProjectBackup(handle.id, name);
		// 名前の衝突による再試行でも同じ旧内容を使い、大きな素材を読み直さない。
		previous ??= new Uint8Array(await (await handle.getFile()).arrayBuffer());
		if (previous.byteLength === 0) return 'empty';
		return await directory.create(name, previous) ? 'created' : 'exists';
	};
}
