import type { ProjectFileHandle } from './gsproj.ts';
import type { ProjectBackupDirectory, ProjectBackupTarget, SaveBackupWriter } from './project-backups.ts';

export type ProjectSaveTarget = {
	handle: ProjectFileHandle;
	directory: FileSystemDirectoryHandle | null;
	backup: ProjectBackupTarget | null;
};

// 保存先と処理順序を同じセッションが所有する。Save asの成功後に待機中のSaveが
// 古い保存先を使わないよう、保存先はキューへの登録時ではなく実行開始時に渡す。
export class ProjectSaveSession {
	private currentTarget: ProjectSaveTarget | null = null;
	private queue: Promise<unknown> = Promise.resolve();
	suggestedName = 'untitled.gsproj';

	constructor(private onTargetChange: (target: ProjectSaveTarget | null, previous: ProjectSaveTarget | null) => void) {}

	get target(): ProjectSaveTarget | null { return this.currentTarget; }

	setTarget(target: ProjectSaveTarget | null): void {
		const previous = this.currentTarget;
		this.currentTarget = target;
		if (target) this.suggestedName = target.handle.name;
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
	let previous: Uint8Array | undefined;
	return async name => {
		// 動画入りの旧プロジェクトをIPCで往復させず、登録された実ファイルをmain側でコピーする。
		if (handle.kind === 'desktop-project-file') return window.desktop!.copyProjectBackup(handle.id, name);
		// 名前の衝突による再試行でも同じ旧内容を使い、大きな素材を読み直さない。
		previous ??= new Uint8Array(await (await handle.getFile()).arrayBuffer());
		if (!previous.byteLength) return 'empty';
		return await directory.create(name, previous) ? 'created' : 'exists';
	};
}
