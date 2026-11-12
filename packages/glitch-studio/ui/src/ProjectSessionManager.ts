import { computed, markRaw, shallowRef } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { ProjectContext } from './Project.ts';
import { ProjectSessionContext } from './ProjectSessionContext.ts';
import { ProjectFileOperationController } from './ProjectFileOperationController.ts';
import { recentProjects } from './recent-projects.ts';
import { isSameProjectFile } from './gsproj.ts';
import type { Project, ProjectFileHandle, SelectedProjectFile } from './gsproj.ts';
import { applicationActivity } from './application-activity.ts';
import { resolveExternalAssets } from './external-assets.ts';
import { i18n } from './i18n.ts';
import * as ui from './ui.ts';

/** ウィンドウ内のセッションの寿命と選択を所有する。保存・編集の状態は各セッションが持つ。 */
export class ProjectSessionManager {
	public readonly sessions = shallowRef<ProjectSessionContext[]>([]);
	public readonly activeSession = shallowRef<ProjectSessionContext | null>(null);
	public readonly isProjectSaving = computed(() => this.sessions.value.some(session => session.isProjectSaving.value));
	public readonly hasUnsavedChanges = computed(() => this.sessions.value.some(session => session.hasUnsavedChanges.value));
	public readonly fileOperations = new ProjectFileOperationController();
	private disposed = false;
	private disposal: Promise<void> | null = null;
	private pendingSession: ProjectSessionContext | null = null;

	constructor() {
		markRaw(this);
	}

	private createSession(project: Project, fileName: string | null, fileHandle: ProjectFileHandle | null, id: string) {
		const session: ProjectSessionContext = new ProjectSessionContext(new ProjectContext(project), {
			id,
			fileName,
			fileHandle,
			fileOperations: this.fileOperations,
			checkSaveDestination: handle => this.checkSaveDestination(session, handle),
		});
		return session;
	}

	private async findFileOwner(handle: ProjectFileHandle, except?: ProjectSessionContext): Promise<ProjectSessionContext | null> {
		for (const session of this.sessions.value) {
			if (session !== except && await isSameProjectFile(session.projectFileHandle.value, handle)) return session;
		}
		return null;
	}

	private async checkSaveDestination(session: ProjectSessionContext, handle: ProjectFileHandle): Promise<void> {
		// 保存受付から完了までOpen・Save・Closeは入らないため、確定した保存先だけを照合する。
		// 別ウィンドウとの競合はElectronのmain側が引き続き予約・書き込み時に検証する。
		if (this.disposed || session.isDisposed) throw new Error('The project has been closed.');
		if (await this.findFileOwner(handle, session) != null) throw new Error(i18n.ts._App.ProjectFileAlreadyOpen);
		if (this.disposed || session.isDisposed) throw new Error('The project has been closed.');
	}

	public open(project: Project | (() => Promise<Project | null>)): Promise<ProjectSessionContext | null> {
		if (this.disposed) return Promise.resolve(null);
		return this.fileOperations.run(() => applicationActivity.run(async () => {
			const preparedProject = typeof project === 'function' ? await project() : project;
			return preparedProject == null ? null : this.openSession(async () => preparedProject, null, null, genId());
		}));
	}

	public openFile(selectFile: (sessionId: string) => Promise<SelectedProjectFile | null>): Promise<ProjectSessionContext | null> {
		if (this.disposed) return Promise.resolve(null);
		return this.fileOperations.run(() => applicationActivity.run(async () => {
			const sessionId = genId();
			try {
				// 選択中も受付を確保し、キャンセル・失敗時のmain側の予約解放まで保持する。
				const file = await selectFile(sessionId);
				if (file == null) return null;
				const session = await this.openSession(file.loadProject, file.name, file.handle, sessionId);
				if (session != null && file.handle != null) await recentProjects.remember(file.handle, session.projectContext.stateManager.state.name.value);
				return session;
			} finally {
				await window.desktop?.releaseProjectReservations?.(sessionId).catch(console.error);
			}
		}));
	}

	/** 呼び出し元がファイル操作を受け付けてから、重複判定・読み込み・起動を行う。 */
	private async openSession(loadProject: () => Promise<Project>, fileName: string | null, handle: ProjectFileHandle | null, id: string): Promise<ProjectSessionContext | null> {
		if (this.disposed) return null;
		const existing = handle == null ? null : await this.findFileOwner(handle);
		// ブラウザーのハンドル照合中にウィンドウが閉じた場合、新しい購読やWorkerを生成しない。
		if (this.disposed) return null;
		if (existing != null) { await this.select(existing); return existing; }
		const waiting = ui.waiting({ text: fileName == null ? i18n.ts._App.InitializingProject : i18n.ts._App.LoadingProjectFile });
		let session: ProjectSessionContext | null = null;
		try {
			// 既存タブを選ぶ場合はgetFile・デコード・素材のパス解決を一切行わない。
			// 新しいファイルも読み込み完了までは一覧に追加せず、失敗時は現在の画面を維持する。
			const project = await loadProject();
			if (this.disposed) return null;
			waiting.setText(i18n.ts._App.InitializingProject);
			// 参照解決による値の変更を初回の編集通知にせず、準備済みの状態から購読を開始する。
			// この待機中にはまだセッションがないため、終了後に生成しないよう確認する。
			await resolveExternalAssets(project.assets);
			if (this.disposed) return null;
			session = this.createSession(project, fileName, handle, id);
			this.pendingSession = session;
			await session.setActive(false);
			waiting.setText(i18n.ts._App.InitializingRenderer);
			await session.start();
			if (this.disposed || session.isDisposed) return null;
			this.sessions.value = [...this.sessions.value, session];
			await this.select(session);
			return this.disposed || session.isDisposed ? null : session;
		} catch (error) {
			await session?.dispose();
			throw error;
		} finally {
			this.pendingSession = null;
			waiting.done();
		}
	}

	public async select(session: ProjectSessionContext): Promise<void> {
		if (this.disposed || session.isDisposed || !this.sessions.value.includes(session)) return;
		const previous = this.activeSession.value;
		if (previous === session) return;
		this.activeSession.value = session;
		// 非選択化はawaitより先に通知する。素早い連続切替でも古い初期化結果を復活させない。
		await Promise.all([previous?.setActive(false), session.setActive(true)]);
	}

	public async selectFile(id: string): Promise<void> {
		const session = this.sessions.value.find(current => {
			const handle = current.projectFileHandle.value;
			return handle?.kind === 'desktop-project-file' && handle.id === id;
		});
		if (session != null) await this.select(session);
	}

	public async close(session: ProjectSessionContext): Promise<boolean> {
		if (this.disposed || !this.sessions.value.includes(session)) return false;
		return await this.fileOperations.run(async () => {
			if (applicationActivity.isExporting.value) {
				await ui.alert({ type: 'info', text: i18n.ts._App.CannotCloseWhileExporting });
				return false;
			}
			if (session.hasUnsavedChanges.value) {
				const result = await ui.confirm({ type: 'warning', title: i18n.ts._App.ConfirmCloseUnsavedProject,
					text: `${session.projectContext.stateManager.state.name.value}\n${i18n.ts._App.UnsavedChangesWillBeLost}`,
					okText: i18n.ts._App.CloseWithoutSaving, cancelText: i18n.ts.Cancel, autofocusAction: 'cancel' });
				if (result.canceled) return false;
			}
			if (this.disposed || session.isDisposed || applicationActivity.isExporting.value) return false;
			const index = this.sessions.value.indexOf(session);
			this.sessions.value = this.sessions.value.filter(current => current !== session);
			const disposal = session.dispose();
			if (this.activeSession.value === session) {
				const next = this.sessions.value[Math.min(index, this.sessions.value.length - 1)];
				if (next != null) await this.select(next);
				else this.activeSession.value = null;
			}
			await disposal;
			return true;
		}) ?? false;
	}

	public async pauseForDesktopUpdate(): Promise<() => Promise<void>> {
		const resumes: (() => Promise<void>)[] = [];
		try {
			for (const session of this.sessions.value) resumes.push(await session.pauseForDesktopUpdate());
		} catch (error) { await Promise.all(resumes.map(resume => resume())); throw error; }
		return async () => { await Promise.all(resumes.map(resume => resume())); };
	}

	public dispose(): Promise<void> {
		if (this.disposal != null) return this.disposal;
		this.disposed = true;
		this.disposal = Promise.all([...this.sessions.value, ...(this.pendingSession == null ? [] : [this.pendingSession])].map(session => session.dispose())).then(() => {});
		return this.disposal;
	}
}
