import { computed, markRaw, shallowRef } from 'vue';
import { ProjectContext } from './Project.ts';
import { ProjectSessionContext } from './ProjectSessionContext.ts';
import { isSameProjectFile } from './gsproj.ts';
import type { Project, ProjectFileHandle } from './gsproj.ts';
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
	private disposed = false;
	private disposal: Promise<void> | null = null;
	private readonly closing = new Set<ProjectSessionContext>();
	private readonly pendingSessions = new Set<ProjectSessionContext>();
	private readonly fileReservations = new Map<ProjectSessionContext, ProjectFileHandle>();
	private fileOperations: Promise<unknown> = Promise.resolve();

	constructor() {
		markRaw(this);
	}

	private createSession(project: Project, fileName: string | null, fileHandle: ProjectFileHandle | null, id?: string) {
		const session: ProjectSessionContext = new ProjectSessionContext(new ProjectContext(project), {
			id,
			fileName,
			fileHandle,
			reserveProjectFile: handle => this.reserveProjectFile(session, handle),
		});
		return session;
	}

	private exclusiveFileOperation<T>(operation: () => Promise<T>): Promise<T> {
		const pending = this.fileOperations.then(operation);
		this.fileOperations = pending.catch(() => {});
		return pending;
	}

	private async findFileOwner(handle: ProjectFileHandle, except?: ProjectSessionContext): Promise<ProjectSessionContext | null> {
		for (const session of this.sessions.value) {
			if (session !== except && await isSameProjectFile(session.projectFileHandle.value, handle)) return session;
		}
		for (const [session, reserved] of this.fileReservations) {
			if (session !== except && await isSameProjectFile(reserved, handle)) return session;
		}
		return null;
	}

	private reserveProjectFile(session: ProjectSessionContext, handle: ProjectFileHandle): Promise<() => void> {
		return this.exclusiveFileOperation(async () => {
			if (this.disposed || session.isDisposed) throw new Error('The project has been closed.');
			if (await this.findFileOwner(handle, session) != null) throw new Error(i18n.ts._App.ProjectFileAlreadyOpen);
			if (this.disposed || session.isDisposed) throw new Error('The project has been closed.');
			this.fileReservations.set(session, handle);
			return () => { this.fileReservations.delete(session); };
		});
	}

	/** 読み込み完了までは一覧に追加せず、失敗しても現在の編集画面を維持する。 */
	public open(project: Project, fileName: string | null = null, handle: ProjectFileHandle | null = null, id?: string): Promise<ProjectSessionContext | null> {
		return applicationActivity.run(() => this.exclusiveFileOperation(async () => {
			if (this.disposed) return null;
			const existing = handle == null ? null : await this.findFileOwner(handle);
			// ブラウザーのハンドル照合中にウィンドウが閉じた場合、新しい購読やWorkerを生成しない。
			if (this.disposed) return null;
			if (existing != null) { await this.select(existing); return existing; }
			const waiting = ui.waiting({ text: i18n.ts._App.InitializingProject });
			let session: ProjectSessionContext | null = null;
			try {
				// 参照解決による値の変更を初回の編集通知にせず、準備済みの状態から購読を開始する。
				// この待機中にはまだセッションがないため、終了後に生成しないよう確認する。
				await resolveExternalAssets(project.assets);
				if (this.disposed) return null;
				session = this.createSession(project, fileName, handle, id);
				this.pendingSessions.add(session);
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
				if (session != null) this.pendingSessions.delete(session);
				waiting.done();
			}
		}));
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
		if (this.disposed || !this.sessions.value.includes(session) || this.closing.has(session)) return false;
		this.closing.add(session);
		try {
			if (session.isProjectSaving.value || applicationActivity.isExporting.value) {
				await ui.alert({ type: 'info', text: session.isProjectSaving.value ? i18n.ts._App.CannotCloseWhileSaving : i18n.ts._App.CannotCloseWhileExporting });
				return false;
			}
			if (session.hasUnsavedChanges.value) {
				const result = await ui.confirm({ type: 'warning', title: i18n.ts._App.ConfirmCloseUnsavedProject,
					text: `${session.projectContext.stateManager.state.name.value}\n${i18n.ts._App.UnsavedChangesWillBeLost}`,
					okText: i18n.ts._App.CloseWithoutSaving, cancelText: i18n.ts.Cancel, autofocusAction: 'cancel' });
				if (result.canceled) return false;
			}
			if (this.disposed || session.isDisposed || session.isProjectSaving.value || applicationActivity.isExporting.value) return false;
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
		} finally { this.closing.delete(session); }
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
		this.disposal = Promise.all([...this.sessions.value, ...this.pendingSessions].map(session => session.dispose())).then(() => {});
		return this.disposal;
	}
}
