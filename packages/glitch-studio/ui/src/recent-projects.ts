import { shallowRef } from 'vue';
import { desktopProjectFile } from './gsproj.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { ProjectFileHandle } from './gsproj.ts';

export type RecentProjectEntry = {
	id: string;
	name: string;
	fileName: string;
	lastUsedAt: number;
};

export interface RecentProjectsStore {
	list(): Promise<RecentProjectEntry[]>;
	remember(handle: ProjectFileHandle, name: string): Promise<void>;
	resolve(id: string): Promise<ProjectFileHandle | null>;
	remove(id: string): Promise<void>;
	clear(): Promise<void>;
}

type BrowserRecentProjectEntry = RecentProjectEntry & { handle: FileSystemFileHandle };

/** ファイル本体は保存せず、ユーザーが選択したハンドルだけを保持する。 */
export class BrowserRecentProjectsStore implements RecentProjectsStore {
	private handles = new Map<string, FileSystemFileHandle>();

	private async database(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open('glitch-studio-recent-projects', 1);
			request.onupgradeneeded = () => { request.result.createObjectStore('projects', { keyPath: 'id' }); };
			request.onsuccess = () => { resolve(request.result); };
			request.onerror = () => { reject(request.error); };
		});
	}

	private async read(): Promise<BrowserRecentProjectEntry[]> {
		const database = await this.database();
		try {
			return await new Promise((resolve, reject) => {
				const transaction = database.transaction('projects', 'readonly');
				const request = transaction.objectStore('projects').getAll();
				transaction.oncomplete = () => { resolve(request.result as BrowserRecentProjectEntry[]); };
				transaction.onabort = () => { reject(transaction.error); };
			});
		} finally {
			database.close();
		}
	}

	private async write(operation: (store: IDBObjectStore) => void): Promise<void> {
		const database = await this.database();
		try {
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction('projects', 'readwrite');
				transaction.oncomplete = () => { resolve(); };
				transaction.onabort = () => { reject(transaction.error); };
				try {
					operation(transaction.objectStore('projects'));
				} catch (error) {
					transaction.abort();
					reject(error);
				}
			});
		} finally {
			database.close();
		}
	}

	async list(): Promise<RecentProjectEntry[]> {
		const entries = (await this.read()).sort((first, second) => second.lastUsedAt - first.lastUsedAt).slice(0, 20);
		this.handles = new Map(entries.map(entry => [entry.id, entry.handle]));
		return entries.map(({ handle: _handle, ...entry }) => entry);
	}

	async remember(handle: ProjectFileHandle, name: string): Promise<void> {
		if (handle.kind !== 'file') return;
		const entries = await this.read();
		// プロジェクトIDや同名ファイルでは判定しない。別名保存・コピー・別フォルダの同名作品を区別する。
		const matches = await Promise.all(entries.map(async entry => await entry.handle.isSameEntry(handle) ? entry.id : null));
		const id = matches.find(candidate => candidate != null) ?? genId();
		const entry = {
			id,
			name,
			fileName: handle.name,
			lastUsedAt: Date.now(),
			handle,
		};
		const retained = [entry, ...entries.filter(candidate => !matches.includes(candidate.id))]
			.sort((first, second) => second.lastUsedAt - first.lastUsedAt).slice(0, 20);
		// isSameEntryの非同期処理をtransactionへ持ち込むと、その間にtransactionが閉じてしまう。
		// 更新と上限超過の削除だけを同じtransactionで確定し、別タブの未知の項目は消さない。
		await this.write(store => {
			for (const previous of entries) {
				if (!retained.some(candidate => candidate.id === previous.id)) store.delete(previous.id);
			}
			store.put(entry);
		});
	}

	async resolve(id: string): Promise<ProjectFileHandle> {
		const handle = this.handles.get(id);
		if (handle == null) throw new Error('The recent project is no longer available. Refresh the list and try again.');
		// 一覧読込時に保持したハンドルを使い、クリック直後に権限を要求する。
		// IndexedDB読込などを先にawaitするとユーザー操作の有効期間を失う可能性がある。
		if (await handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('Read permission was not granted.');
		return handle;
	}

	async remove(id: string): Promise<void> { await this.write(store => { store.delete(id); }); }
	async clear(): Promise<void> { await this.write(store => { store.clear(); }); }
}

function desktopRecentProjectsStore(): RecentProjectsStore {
	return {
		list: () => window.desktop!.listRecentProjects(),
		remember: async (handle, name) => {
			if (handle.kind === 'desktop-project-file') await window.desktop!.rememberRecentProject(handle.id, name);
		},
		resolve: async id => {
			const descriptor = await window.desktop!.resolveRecentProject(id);
			return descriptor == null ? null : desktopProjectFile(descriptor);
		},
		remove: id => window.desktop!.removeRecentProject(id),
		clear: () => window.desktop!.clearRecentProjects(),
	};
}

/** 履歴はプロジェクト内容やUndoの対象ではない。永続化の失敗も本体のOpen/Saveへ伝播させない。 */
export class RecentProjectsController {
	readonly entries = shallowRef<RecentProjectEntry[]>([]);
	readonly error = shallowRef<string | null>(null);
	private queue: Promise<void> = Promise.resolve();

	constructor(private store: RecentProjectsStore | null) {}

	private update(operation: () => Promise<void>): Promise<void> {
		const result = this.queue.then(async () => {
			try {
				await operation();
				this.entries.value = await this.store?.list() ?? [];
				this.error.value = null;
			} catch (error) {
				this.error.value = error instanceof Error ? error.message : String(error);
			}
		});
		this.queue = result;
		return result;
	}

	refresh(): Promise<void> { return this.update(async () => {}); }
	remember(handle: ProjectFileHandle, name: string): Promise<void> { return this.update(async () => { await this.store?.remember(handle, name); }); }
	remove(id: string): Promise<void> { return this.update(async () => { await this.store?.remove(id); }); }
	clear(): Promise<void> { return this.update(async () => { await this.store?.clear(); }); }
	resolve(id: string): Promise<ProjectFileHandle | null> {
		if (this.store == null) return Promise.reject(new Error('Recent projects are unavailable.'));
		return this.store.resolve(id);
	}
}

export const recentProjects = new RecentProjectsController(
	typeof window !== 'undefined' && window.desktop?.listRecentProjects != null ? desktopRecentProjectsStore()
		: typeof indexedDB !== 'undefined' ? new BrowserRecentProjectsStore() : null,
);
