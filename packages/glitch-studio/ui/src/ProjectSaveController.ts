import { computed, readonly, ref, shallowRef, watch } from 'vue';
import { recentProjects } from './recent-projects.ts';
import { preferences } from './preferences.ts';
import { ProjectSaveQueue } from './ProjectSaveQueue.ts';
import { createProjectBackupFingerprint, ProjectBackupController } from './project-backups.ts';
import { desktopProjectFile, encodeProjectFile, saveProjectFile } from './gsproj.ts';
import { browserProjectBackupDirectory, desktopProjectBackupDirectory, projectSaveBackupWriter } from './project-backup-directory.ts';
import GsProjectSaveDialog from './components/GsProjectSaveDialog.vue';
import GsProjectBackupFolderDialog from './components/GsProjectBackupFolderDialog.vue';
import type { Project, ProjectFileHandle } from './gsproj.ts';
import type { ProjectBackupStatus, ProjectBackupTarget } from './project-backups.ts';
import type { ProjectFileOperationController } from './ProjectFileOperationController.ts';
import * as ui from '@/ui.ts';

type ProjectSaveTarget = { handle: ProjectFileHandle; backup: ProjectBackupTarget | null };

function resolveBackupTarget(handle: ProjectFileHandle, directory: FileSystemDirectoryHandle | null): ProjectBackupTarget | null {
	const native = handle.kind === 'desktop-project-file' ? desktopProjectBackupDirectory(handle.id) : null;
	return native ? { name: handle.name, directory: native } : directory ? { name: handle.name, directory: browserProjectBackupDirectory(directory) } : null;
}

async function selectProjectSaveFile(name: string, popup: typeof ui.popup, sessionId: string): Promise<{ handle: ProjectFileHandle; directory: FileSystemDirectoryHandle | null } | null> {
	if (window.desktop?.chooseProjectSaveFile) {
		const descriptor = await window.desktop.chooseProjectSaveFile(name, sessionId);
		return descriptor ? { handle: desktopProjectFile(descriptor), directory: null } : null;
	}
	return new Promise(resolve => {
		const { dispose } = popup(GsProjectSaveDialog, { name }, {
			selected: (handle, directory) => resolve({ handle, directory: directory ?? null }),
			closed: () => { resolve(null); dispose(); },
		});
	});
}

function requestBackupDirectory(handle: FileSystemFileHandle, popup: typeof ui.popup): Promise<FileSystemDirectoryHandle | null> {
	return new Promise(resolve => {
		const { dispose } = popup(GsProjectBackupFolderDialog, { handle }, {
			selected: directory => resolve(directory),
			closed: () => { resolve(null); dispose(); },
		});
	});
}

function backupSettings() {
	return {
		autoEnabled: preferences.s.projectBackupAutoEnabled,
		autoIntervalMinutes: preferences.s.projectBackupAutoIntervalMinutes,
		autoRetentionDays: preferences.s.projectBackupAutoRetentionDays,
		saveEnabled: preferences.s.projectBackupSaveEnabled,
		saveRetentionDays: preferences.s.projectBackupSaveRetentionDays,
	};
}

/** 保存先の選択・権限・保存処理とバックアップをまとめ、プレビューの実装に依存させない。 */
export class ProjectSaveController {
	// 終了時は編集状態が変わらなくても、未保存変更の表示を解除する。
	private readonly disposed = ref(false);
	private disposal: Promise<void> | null = null;
	private readonly stopBackupSettings: () => void;
	private readonly sessionId: string;
	private readonly fileOperations: ProjectFileOperationController;
	private readonly checkSaveDestination: (handle: ProjectFileHandle) => Promise<void>;
	private pausedForUpdate = false;
	private updatePreparationError: unknown = null;
	private readonly saveQueue = new ProjectSaveQueue();
	private readonly saveTarget = shallowRef<ProjectSaveTarget | null>(null);
	private readonly initialFileName: string | null;
	private backupFingerprint = createProjectBackupFingerprint();
	private savedFingerprint = ref<string | null>(null);
	private readonly saving = ref(false);
	public readonly isProjectSaving = readonly(this.saving);
	// 履歴の件数では、Undo・直接編集されるプロジェクト情報・生成音声の変更を判定できない。
	// 保存対象そのものを比較し、不変なBlobはバックアップと同じ同一性で扱う。
	public hasUnsavedChanges = computed(() => {
		const project = this.disposed.value ? null : this.getSnapshot();
		return project != null && this.backupFingerprint(project) !== this.savedFingerprint.value;
	});
	// Fileだけで開いた名前は保存先が確定するまで使い、ハンドルやアクセス状態は保存先から導出する。
	public readonly projectFileName = computed(() => this.disposed.value ? null : this.saveTarget.value?.handle.name ?? this.initialFileName);
	public readonly projectFileHandle = computed(() => this.saveTarget.value?.handle ?? null);
	public readonly projectBackupAccess = computed(() => this.saveTarget.value == null ? 'unsaved' : this.saveTarget.value.backup == null ? 'folder-required' : 'ready');
	public projectBackupStatus = ref<ProjectBackupStatus>({ lastAutoBackup: null, lastSaveBackup: null, error: null });
	private readonly projectBackupController: ProjectBackupController;

	constructor(private getSnapshot: () => Project | null,
		options: {
			fileName: string | null;
			fileHandle: ProjectFileHandle | null;
			sessionId: string;
			fileOperations: ProjectFileOperationController;
			checkSaveDestination: (handle: ProjectFileHandle) => Promise<void>;
		}, private popup: typeof ui.popup = ui.popup) {
		this.sessionId = options.sessionId;
		this.fileOperations = options.fileOperations;
		this.checkSaveDestination = options.checkSaveDestination;
		this.initialFileName = options.fileName;

		this.projectBackupController = new ProjectBackupController({
			runExclusive: operation => this.saveQueue.runExclusive(operation),
			settings: backupSettings,
			snapshot: () => {
				const project = this.getSnapshot();
				return project != null ? { fingerprint: this.backupFingerprint(project), encode: () => encodeProjectFile(project, this.projectFileHandle.value) } : null;
			},
			onStatus: status => { this.projectBackupStatus.value = status; },
			now: () => Date.now(),
			schedule: (callback, delay) => window.setTimeout(callback, delay),
			cancel: timer => { if (timer != null) window.clearTimeout(timer as number); },
		});
		this.stopBackupSettings = watch(() => [preferences.r.projectBackupAutoEnabled.value, preferences.r.projectBackupAutoIntervalMinutes.value,
			preferences.r.projectBackupAutoRetentionDays.value, preferences.r.projectBackupSaveEnabled.value,
			preferences.r.projectBackupSaveRetentionDays.value], () => this.projectBackupController.refreshSchedule());

		const { fileName, fileHandle } = options;
		// Fileから開いた場合も読み込み直後は保存済みとする。新規プロジェクトは初回保存が必要。
		// 比較基準を生成時に確定し、非同期の起動中に行われた編集を保存済みとして取り込まない。
		const savedProject = fileName != null || fileHandle != null ? this.getSnapshot() : null;
		this.savedFingerprint.value = savedProject != null ? this.backupFingerprint(savedProject) : null;
		this.setSaveTarget(fileHandle != null ? { handle: fileHandle, backup: resolveBackupTarget(fileHandle, null) } : null);
	}

	private setSaveTarget(target: ProjectSaveTarget | null): void {
		const previous = this.saveTarget.value;
		this.saveTarget.value = target;
		// 通常保存では同じバックアップ先を引き継ぎ、間隔・履歴・エラーを初期化しない。
		if (target?.backup !== previous?.backup) this.projectBackupController.setTarget(target?.backup ?? null);
	}

	public async saveProject(saveAs = false): Promise<void> {
		if (this.disposed.value || this.pausedForUpdate) return;
		const releaseOperation = this.fileOperations.tryBegin();
		if (releaseOperation == null) return;
		this.saving.value = true;
		let saveFailure: { error: unknown } | null = null;
		try {
			const project = this.getSnapshot();
			if (project == null) return;
			const requestedTarget = saveAs ? null : this.saveTarget.value;
			const requestedHandle = requestedTarget?.handle ?? null;
			// ブラウザーでは待ち行列やエンコードより前に権限要求を始め、クリックの有効期間を失わない。
			// 待機中の拒否は値として受け、未処理のPromise rejectionにしない。
			const permission = requestedHandle?.kind === 'file'
				? requestedHandle.requestPermission({ mode: 'readwrite' }).catch((error: unknown) => error) : null;
			saveFailure = await this.saveQueue.runExclusive(async () => {
				try {
					// セッションの入れ替えは行わない。終了後に届いた権限・選択・エンコード結果だけを無効化する。
					if (this.disposed.value) return null;
					const fingerprint = this.backupFingerprint(project);
					let handle = requestedHandle;
					let directory: FileSystemDirectoryHandle | null = null;
					let target = requestedTarget?.backup ?? null;
					// 待機するのは自動バックアップだけ。後続のSave／Save asは受け付けないため、
					// 要求時の保存先と権限をそのまま使える。保存中の編集はスナップショットへ混ぜない。
					if (handle?.kind === 'file' && await permission !== 'granted') throw new Error('Write permission was not granted. Use Save as... to choose another file.');
					// 外部参照の相対化には保存先が必要だが、埋め込み原本の読込失敗で
					// ブラウザの保存先を空にしない従来の順序は維持する。
					let data = handle == null && window.desktop?.assetProjectPaths != null ? null : await encodeProjectFile(project, handle);
					if (this.disposed.value) return null;
					if (handle == null) {
						const selected = await selectProjectSaveFile(this.projectFileName.value ?? 'untitled.gsproj', this.popup, this.sessionId);
						if (selected == null || this.disposed.value) return null;
						({ handle, directory } = selected);
					}
					// 別タブの確定した保存先と照合し、バックアップを作る前に拒否する。
					await this.checkSaveDestination(handle);
					if (this.disposed.value) return null;
					target ??= resolveBackupTarget(handle, directory);
					data ??= await encodeProjectFile(project, handle);
					if (backupSettings().saveEnabled && (target == null || !await target.directory.hasPermission())) {
						if (handle.kind === 'desktop-project-file') throw new Error('The project backup folder is unavailable.');
						directory = await requestBackupDirectory(handle, this.popup);
						if (directory == null) return null;
						target = { name: handle.name, directory: browserProjectBackupDirectory(directory) };
					}
					if (this.disposed.value) return null;
					let saveBackupTime: number | null = null;
					if (target != null && backupSettings().saveEnabled) {
						// 上書き前の実ファイルのバックアップが確定してから、本体を変更する。
						saveBackupTime = await this.projectBackupController.beforeSave(target, projectSaveBackupWriter(handle, target.directory));
					}
					if (this.disposed.value) return null;
					await saveProjectFile(data, handle, this.sessionId);
					if (!this.disposed.value) {
						// 保存中の編集を保存済みにしないよう、書き込んだスナップショットを基準にする。
						// バックアップ整理の成否ではなく、本体の書き込み成功時点で更新する。
						this.savedFingerprint.value = fingerprint;
						this.setSaveTarget({ handle, backup: target });
						void recentProjects.remember(handle, project.name);
						if (target != null) await this.projectBackupController.afterSave(target, saveBackupTime);
					}
				} catch (error) {
					console.error(error);
					return { error };
				} finally {
					// 予約の解放まで保存キューに含め、更新の準備が後処理を追い越さないようにする。
					await window.desktop?.releaseProjectReservations?.(this.sessionId).catch(console.error);
				}
				return null;
			});
		} finally {
			this.saving.value = false;
			releaseOperation();
		}
		// エラーの確認待ちは保存処理ではないため、保存中の表示と終了防止を先に解除する。
		if (saveFailure != null) {
			const { error } = saveFailure;
			// 更新の要求元へ失敗を返し、更新の待機表示を解除してから報告する。
			// 後処理中に停止を要求された場合も、失敗を見落とさない。
			if (this.pausedForUpdate) this.updatePreparationError = error;
			else if (!this.disposed.value) await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
		}
	}

	public async pauseForUpdate(): Promise<() => void> {
		if (this.disposed.value) return () => {};
		this.pausedForUpdate = true;
		this.updatePreparationError = null;
		this.projectBackupController.setPaused(true);
		const resume = () => {
			if (this.disposed.value) return;
			this.pausedForUpdate = false;
			this.projectBackupController.setPaused(false);
		};
		// 既に受け付けた手動保存とバックアップは、削除・整理も含めて完了を待つ。
		await this.saveQueue.whenIdle();
		if (this.updatePreparationError != null) {
			resume();
			throw this.updatePreparationError;
		}
		return resume;
	}

	public dispose(): Promise<void> {
		if (this.disposal != null) return this.disposal;
		this.disposed.value = true;
		this.stopBackupSettings();
		this.projectBackupController.dispose();
		// 書き込み開始後は途中で打ち切らず、予約の解放まで待って保存先を手放す。
		this.disposal = this.saveQueue.whenIdle().then(() => { this.saveTarget.value = null; });
		return this.disposal;
	}
}
