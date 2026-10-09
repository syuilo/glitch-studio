import { computed, ref, watch } from 'vue';
import { preferences } from './preferences.ts';
import { projectSaveBackupWriter, ProjectSaveSession } from './project-save-session.ts';
import { createProjectBackupFingerprint, DEFAULT_PROJECT_BACKUP_SETTINGS, ProjectBackupController } from './project-backups.ts';
import { desktopProjectFile, encodeProjectFile, saveProjectFile } from './gsproj.ts';
import { browserProjectBackupDirectory, desktopProjectBackupDirectory, selectProjectBackupFolder } from './project-backup-directory.ts';
import GsProjectSaveDialog from './components/GsProjectSaveDialog.vue';
import GsProjectBackupFolderDialog from './components/GsProjectBackupFolderDialog.vue';
import type { Project, ProjectFileHandle } from './gsproj.ts';
import type { ProjectBackupStatus, ProjectBackupTarget } from './project-backups.ts';
import * as ui from '@/ui.ts';

function resolveBackupTarget(handle: ProjectFileHandle, directory: FileSystemDirectoryHandle | null): ProjectBackupTarget | null {
	const native = handle.kind === 'desktop-project-file' ? desktopProjectBackupDirectory(handle.id) : null;
	return native ? { name: handle.name, directory: native } : directory ? { name: handle.name, directory: browserProjectBackupDirectory(directory) } : null;
}

async function selectProjectSaveFile(name: string): Promise<{ handle: ProjectFileHandle; directory: FileSystemDirectoryHandle | null } | null> {
	if (window.desktop?.chooseProjectSaveFile) {
		const descriptor = await window.desktop.chooseProjectSaveFile(name);
		return descriptor ? { handle: desktopProjectFile(descriptor), directory: null } : null;
	}
	return new Promise(resolve => {
		const { dispose } = ui.popup(GsProjectSaveDialog, { name }, {
			selected: (handle, directory) => resolve({ handle, directory: directory ?? null }),
			closed: () => { resolve(null); dispose(); },
		});
	});
}

function requestBackupDirectory(handle: FileSystemFileHandle): Promise<FileSystemDirectoryHandle | null> {
	return new Promise(resolve => {
		const { dispose } = ui.popup(GsProjectBackupFolderDialog, { handle }, {
			selected: directory => resolve(directory),
			closed: () => { resolve(null); dispose(); },
		});
	});
}

function backupSettings() { return preferences.s.projectBackups ?? DEFAULT_PROJECT_BACKUP_SETTINGS; }

/** 保存先の選択・権限・保存処理とバックアップをまとめ、プレビューの実装に依存させない。 */
export class ProjectSaveController {
	private projectGeneration = 0;
	private projectReady = ref(false);
	private projectSaveSession: ProjectSaveSession;
	private backupFingerprint = createProjectBackupFingerprint();
	private savedFingerprint = ref<string | null>(null);
	// 履歴の件数では、Undo・直接編集されるプロジェクト情報・生成音声の変更を判定できない。
	// 保存対象そのものを比較し、不変なBlobはバックアップと同じ同一性で扱う。
	public hasUnsavedChanges = computed(() => {
		const project = this.projectReady.value ? this.getSnapshot() : null;
		return project != null && this.backupFingerprint(project) !== this.savedFingerprint.value;
	});
	public projectFileName = ref<string | null>(null);
	public projectBackupAccess = ref<'unsaved' | 'folder-required' | 'ready'>('unsaved');
	public projectBackupStatus = ref<ProjectBackupStatus>({ lastAutoBackup: null, lastSaveBackup: null, error: null });
	public projectBackupController: ProjectBackupController;

	constructor(private getSnapshot: () => Project | null) {
		this.projectSaveSession = new ProjectSaveSession((target, previous) => {
			this.projectFileName.value = target?.handle.name ?? null;
			this.projectBackupAccess.value = target?.backup ? 'ready' : target ? 'folder-required' : 'unsaved';
			if (target?.backup !== previous?.backup) this.projectBackupController.setTarget(target?.backup ?? null);
		});

		this.projectBackupController = new ProjectBackupController({
			runExclusive: operation => this.projectSaveSession.runExclusive(operation),
			settings: backupSettings,
			snapshot: () => {
				const project = this.projectReady.value ? this.getSnapshot() : null;
				return project ? { fingerprint: this.backupFingerprint(project), encode: () => encodeProjectFile(project) } : null;
			},
			onStatus: status => { this.projectBackupStatus.value = status; },
			now: () => Date.now(),
			schedule: (callback, delay) => window.setTimeout(callback, delay),
			cancel: timer => { if (timer != null) window.clearTimeout(timer as number); },
		});
		watch(() => preferences.r.projectBackups?.value, () => this.projectBackupController.refreshSchedule(), { deep: true });
	}

	// IDは同じプロジェクトの再読込でも変わらないため、保存要求の失効には使わない。
	// 読み込み開始で世代を進め、完了までは手動保存・自動バックアップの両方を止める。
	public beginProjectLoad(): void {
		this.projectGeneration++;
		this.projectReady.value = false;
		this.savedFingerprint.value = null;
		this.projectSaveSession.setTarget(null);
	}

	public finishProjectLoad(fileName: string | null, fileHandle: ProjectFileHandle | null): void {
		this.projectSaveSession.suggestedName = fileName ?? 'untitled.gsproj';
		// Fileから開いた場合も読み込み直後は保存済みとする。新規プロジェクトは初回保存が必要。
		const project = this.getSnapshot();
		this.savedFingerprint.value = project && (fileName != null || fileHandle != null) ? this.backupFingerprint(project) : null;
		this.projectReady.value = true;
		try {
			this.projectSaveSession.setTarget(fileHandle ? { handle: fileHandle, directory: null, backup: resolveBackupTarget(fileHandle, null) } : null);
		} catch (error) {
			this.projectSaveSession.setTarget(fileHandle ? { handle: fileHandle, directory: null, backup: null } : null);
			this.projectBackupController.reportError(error);
		}
		// Fileだけで開いた場合も、保存先ハンドルの有無によらず読み込んだ名前を表示する。
		this.projectFileName.value = fileHandle?.name ?? fileName;
	}

	public async grantProjectBackupAccess(): Promise<void> {
		const savedTarget = this.projectSaveSession.target;
		const handle = savedTarget?.handle;
		if (!handle) return;
		try {
			if (handle.kind === 'desktop-project-file') {
				const target = resolveBackupTarget(handle, null);
				if (this.projectSaveSession.target === savedTarget && target) this.projectSaveSession.setTarget({ handle, directory: null, backup: target });
				return;
			}
			// フォルダ選択はこのクリックから開始する。タイマーから権限ダイアログを要求しない。
			const directory = await selectProjectBackupFolder(handle);
			if (this.projectSaveSession.target !== savedTarget) return;
			this.projectSaveSession.setTarget({ handle, directory, backup: resolveBackupTarget(handle, directory) });
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) this.projectBackupController.reportError(error);
		}
	}

	public async saveProject(saveAs = false): Promise<void> {
		const project = this.projectReady.value ? this.getSnapshot() : null;
		if (!project) return;
		const fingerprint = this.backupFingerprint(project);
		const generation = this.projectGeneration;
		const requestedHandle = saveAs ? null : this.projectSaveSession.target?.handle;
		// 待ち行列やエンコードより前に権限要求を始め、クリックの有効期間を失わない。
		// 待機中の拒否は値として受け、未処理のPromise rejectionにしない。
		const permission = requestedHandle?.requestPermission({ mode: 'readwrite' }).catch((error: unknown) => error);
		await this.projectSaveSession.runExclusive(async savedTarget => {
			try {
				if (generation !== this.projectGeneration) return;
				let handle = saveAs ? null : savedTarget?.handle ?? null;
				let directory = saveAs ? null : savedTarget?.directory ?? null;
				let target = saveAs ? null : savedTarget?.backup ?? null;
				// 待機中にSave asが成功した場合、その保存先は選択時に許可済み。
				// 旧ハンドルの権限結果を流用せず確認し、ユーザー操作のないキュー内で新たな権限要求はしない。
				const granted = handle === requestedHandle ? await permission
					: handle?.kind === 'file' ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
				if (handle && granted !== 'granted') throw new Error('Write permission was not granted. Use Save as... to choose another file.');
				const data = await encodeProjectFile(project);
				if (generation !== this.projectGeneration) return;
				if (!handle) {
					const selected = await selectProjectSaveFile(this.projectSaveSession.suggestedName);
					if (!selected) return;
					({ handle, directory } = selected);
				}
				if (generation !== this.projectGeneration) return;
				target ??= resolveBackupTarget(handle, directory);
				if (backupSettings().saveEnabled && (!target || !await target.directory.hasPermission())) {
					if (handle.kind === 'desktop-project-file') throw new Error('The project backup folder is unavailable.');
					directory = await requestBackupDirectory(handle);
					if (!directory) return;
					target = { name: handle.name, directory: browserProjectBackupDirectory(directory) };
				}
				if (generation !== this.projectGeneration) return;
				let saveBackupTime: number | null = null;
				if (target && backupSettings().saveEnabled) {
					// 上書き前の実ファイルのバックアップが確定してから、本体を変更する。
					saveBackupTime = await this.projectBackupController.beforeSave(target, projectSaveBackupWriter(handle, target.directory));
				}
				if (generation !== this.projectGeneration) return;
				await saveProjectFile(data, handle);
				if (generation === this.projectGeneration) {
					// 保存中の編集を保存済みにしないよう、書き込んだスナップショットを基準にする。
					// バックアップ整理の成否ではなく、本体の書き込み成功時点で更新する。
					this.savedFingerprint.value = fingerprint;
					this.projectSaveSession.setTarget({ handle, directory, backup: target });
					if (target) await this.projectBackupController.afterSave(target, saveBackupTime);
				}
			} catch (error) {
				console.error(error);
				await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			}
		});
	}
}
