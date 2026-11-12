import type { ProjectFileHandle } from './gsproj.ts';
import type { ProjectBackupDirectory, ProjectBackupTarget, SaveBackupWriter } from './project-backups.ts';

export type ProjectSaveTarget = {
	handle: ProjectFileHandle;
	directory: FileSystemDirectoryHandle | null;
	backup: ProjectBackupTarget | null;
};

// 保存先と、手動保存・自動バックアップの書き込み順序を所有する。
// 手動保存の重複受付はウィンドウ側で拒否し、このキューはバックアップとの直列化に使う。
export class ProjectSaveSession {
	private currentTarget: ProjectSaveTarget | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private onTargetChange: (target: ProjectSaveTarget | null, previous: ProjectSaveTarget | null) => void) {}

	get target(): ProjectSaveTarget | null { return this.currentTarget; }
	async whenIdle(): Promise<void> { await this.queue; }

	setTarget(target: ProjectSaveTarget | null): void {
		const previous = this.currentTarget;
		this.currentTarget = target;
		this.onTargetChange(target, previous);
	}

	// 自動バックアップ中の手動保存も捨てず、失敗したジョブで後続を止めない。
	runExclusive<T>(operation: (target: ProjectSaveTarget | null) => Promise<T>): Promise<T> {
		const result = this.queue.then(() => operation(this.currentTarget));
		this.queue = result.catch(() => {});
		return result;
	}
}

export function projectSaveBackupWriter(handle: ProjectFileHandle, directory: ProjectBackupDirectory): SaveBackupWriter {
	let previous: Uint8Array | null = null;
	return async name => {
		// 動画入りの旧プロジェクトをIPCで往復させず、登録された実ファイルをmain側でコピーする。
		if (handle.kind === 'desktop-project-file') return window.desktop!.copyProjectBackup(handle.id, name);
		// 名前の衝突による再試行でも同じ旧内容を使い、大きな素材を読み直さない。
		previous ??= new Uint8Array(await (await handle.getFile()).arrayBuffer());
		if (!previous.byteLength) return 'empty';
		return await directory.create(name, previous) ? 'created' : 'exists';
	};
}
