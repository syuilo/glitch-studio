export type ProjectBackupKind = 'auto' | 'save';

export type ProjectBackupSettings = {
	autoEnabled: boolean;
	autoIntervalMinutes: number;
	autoRetentionDays: number;
	saveEnabled: boolean;
	saveRetentionDays: number;
};

export const DEFAULT_PROJECT_BACKUP_SETTINGS: ProjectBackupSettings = {
	autoEnabled: false,
	autoIntervalMinutes: 1,
	autoRetentionDays: 1,
	saveEnabled: false,
	saveRetentionDays: 7,
};

export interface ProjectBackupDirectory {
	hasPermission(): Promise<boolean>;
	list(): Promise<string[]>;
	// 同名ファイルがある場合は変更せずfalseを返す。
	create(name: string, data: Uint8Array): Promise<boolean>;
	remove(name: string): Promise<void>;
}

export type ProjectBackupTarget = { name: string; directory: ProjectBackupDirectory };
export type ProjectBackupStatus = { lastAutoBackup: number | null; lastSaveBackup: number | null; error: string | null };
export type SaveBackupWriter = (name: string) => Promise<'created' | 'exists' | 'empty'>;

export function validateProjectBackupSettings(settings: ProjectBackupSettings): void {
	for (const value of [settings.autoIntervalMinutes, settings.autoRetentionDays, settings.saveRetentionDays]) {
		if (!Number.isSafeInteger(value) || value < 1 || value > 525600) {
			throw new Error('Backup intervals and retention periods must be whole numbers between 1 and 525600.');
		}
	}
}

function backupPrefix(projectName: string, kind: ProjectBackupKind): string {
	return `${projectName.replace(/\.gsproj$/i, '')}.${kind}-backup-`;
}

export function projectBackupName(projectName: string, kind: ProjectBackupKind, time: number, sequence = 0): string {
	const date = new Date(time);
	const timestamp = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-');
	return `${backupPrefix(projectName, kind)}${timestamp}${sequence ? `-${sequence}` : ''}.gsproj`;
}

export function projectBackupTime(projectName: string, kind: ProjectBackupKind, name: string): number | null {
	const prefix = backupPrefix(projectName, kind);
	if (!name.startsWith(prefix)) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})(?:-([1-9]\d*))?\.gsproj$/.exec(name.slice(prefix.length));
	if (!match) return null;
	const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
	const date = new Date(year, month - 1, day, hour, minute, second);
	// Dateによる日付の繰り上がりを認めず、紛らわしい手動ファイルは削除対象から除く。
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
		|| date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
	return date.getTime();
}

export async function writeProjectBackup(target: ProjectBackupTarget, kind: ProjectBackupKind, data: Uint8Array, time: number): Promise<string> {
	if (!data.byteLength) throw new Error('The backup contains no save data.');
	if (!await target.directory.hasPermission()) throw new Error('Backup folder access is required. Open Preferences to grant access.');
	for (let sequence = 0; ; sequence++) {
		const name = projectBackupName(target.name, kind, time, sequence);
		if (await target.directory.create(name, data)) return name;
	}
}

export async function pruneProjectBackups(target: ProjectBackupTarget, kind: ProjectBackupKind, retentionDays: number, time: number, protectedName?: string): Promise<void> {
	if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('Invalid backup retention period.');
	if (!await target.directory.hasPermission()) throw new Error('Backup folder access is required. Open Preferences to grant access.');
	const cutoff = time - retentionDays * 86400000;
	for (const name of await target.directory.list()) {
		const created = projectBackupTime(target.name, kind, name);
		if (name !== protectedName && created != null && created < cutoff) await target.directory.remove(name);
	}
}

// JSONの比較対象にBlobの内容は展開しない。不変なBlobの同一性を使えば、素材の差し替えを
// 検出しつつ、変更のない巨大な動画をバックアップ間隔ごとに読み直さずに済む。
export function createProjectBackupFingerprint(): (project: unknown) => string {
	const blobs = new WeakMap<Blob, number>();
	let nextId = 0;
	return project => JSON.stringify(project, (_key, value: unknown) => {
		if (!(value instanceof Blob)) return value;
		if (!blobs.has(value)) blobs.set(value, ++nextId);
		return { backupBlobId: blobs.get(value) };
	});
}

type BackupControllerOptions = {
	runExclusive<T>(operation: () => Promise<T>): Promise<T>;
	settings(): ProjectBackupSettings;
	snapshot(): { fingerprint: string; encode(): Promise<Uint8Array> } | null;
	onStatus(status: ProjectBackupStatus): void;
	now(): number;
	schedule(callback: () => void, delay: number): unknown;
	cancel(timer: unknown): void;
};

export class ProjectBackupController {
	private target: ProjectBackupTarget | null = null;
	private generation = 0;
	private lastFingerprint: string | null = null;
	private lastAutoBackupName: string | undefined;
	private autoBackupFailed = false;
	private nextAutoBackup = 0;
	private timer: unknown;
	private status: ProjectBackupStatus = { lastAutoBackup: null, lastSaveBackup: null, error: null };

	constructor(private options: BackupControllerOptions) {}

	setTarget(target: ProjectBackupTarget | null): void {
		this.target = target;
		this.generation++;
		this.lastFingerprint = null;
		this.lastAutoBackupName = undefined;
		this.autoBackupFailed = false;
		this.status = { lastAutoBackup: null, lastSaveBackup: null, error: null };
		this.publish();
		this.refreshSchedule();
	}

	refreshSchedule(): void {
		this.options.cancel(this.timer);
		this.timer = undefined;
		this.nextAutoBackup = this.options.now() + this.options.settings().autoIntervalMinutes * 60000;
		this.schedule();
	}

	reportError(error: unknown): void {
		this.status.error = error instanceof Error ? error.message : String(error);
		this.publish();
	}

	private publish(): void { this.options.onStatus({ ...this.status }); }

	private schedule(): void {
		this.options.cancel(this.timer);
		this.timer = undefined;
		const settings = this.options.settings();
		if (!this.target || (!settings.autoEnabled && !settings.saveEnabled)) return;
		try { validateProjectBackupSettings(settings); } catch (error) { this.reportError(error); return; }
		// 長い間隔でも期限の整理は行う。復帰時は現在の状態を1回だけ保存し、休止中の回数を積まない。
		this.timer = this.options.schedule(() => { void this.tick().finally(() => this.schedule()); },
			settings.autoEnabled ? Math.max(1, Math.min(60000, this.nextAutoBackup - this.options.now())) : 60000);
	}

	async tick(): Promise<void> {
		const target = this.target;
		const generation = this.generation;
		await this.options.runExclusive(async () => {
			if (!target || generation !== this.generation) return;
			try {
				const settings = this.options.settings();
				validateProjectBackupSettings(settings);
				const now = this.options.now();
				let automaticError = settings.autoEnabled && this.autoBackupFailed ? this.status.error : null;
				try {
					if (settings.autoEnabled && now >= this.nextAutoBackup) {
						this.nextAutoBackup = now + settings.autoIntervalMinutes * 60000;
						const snapshot = this.options.snapshot();
						if (snapshot && snapshot.fingerprint !== this.lastFingerprint) {
							this.autoBackupFailed = true;
							const data = await snapshot.encode();
							if (generation !== this.generation) return;
							const name = await writeProjectBackup(target, 'auto', data, now);
							if (generation !== this.generation) return;
							this.lastAutoBackupName = name;
							this.lastFingerprint = snapshot.fingerprint;
							this.status.lastAutoBackup = now;
							this.autoBackupFailed = false;
						} else if (snapshot) this.autoBackupFailed = false;
					}
					if (generation !== this.generation) return;
					// 新しい復元地点を作れない間は以前の自動バックアップを消さず、失敗表示も維持する。
					// 未変更なら新規作成を省略するため、最後に成功した1件は期限を超えても残す。
					// 次の作成に成功すると保護対象が移り、以前の復元地点は通常の期限で整理される。
					if (settings.autoEnabled && this.lastFingerprint != null && !this.autoBackupFailed) {
						await pruneProjectBackups(target, 'auto', settings.autoRetentionDays, now, this.lastAutoBackupName);
					}
					if (!this.autoBackupFailed) automaticError = null;
				} catch (error) {
					automaticError = error instanceof Error ? error.message : String(error);
				}
				if (generation !== this.generation) return;
				let saveError: string | null = null;
				try {
					// 自動バックアップの失敗によって、独立した保存時バックアップの期限整理を止めない。
					if (settings.saveEnabled) await pruneProjectBackups(target, 'save', settings.saveRetentionDays, now);
				} catch (error) {
					saveError = error instanceof Error ? error.message : String(error);
				}
				if (generation !== this.generation) return;
				this.status.error = [automaticError, saveError].filter(Boolean).join('\n') || null;
			} catch (error) {
				if (generation !== this.generation) return;
				this.reportError(error);
			}
			this.publish();
		});
	}

	async beforeSave(target: ProjectBackupTarget, copyPrevious: SaveBackupWriter): Promise<number | null> {
		if (!this.options.settings().saveEnabled) return null;
		validateProjectBackupSettings(this.options.settings());
		const now = this.options.now();
		const generation = this.generation;
		if (!await target.directory.hasPermission()) throw new Error('Backup folder access is required. Open Preferences to grant access.');
		for (let sequence = 0; ; sequence++) {
			const result = await copyPrevious(projectBackupName(target.name, 'save', now, sequence));
			if (result === 'empty') return null;
			if (result === 'created') break;
		}
		if (generation === this.generation) {
			this.status.lastSaveBackup = now;
			this.publish();
		}
		return now;
	}

	async afterSave(target: ProjectBackupTarget, saveBackupTime: number | null): Promise<void> {
		const generation = this.generation;
		if (saveBackupTime != null) this.status.lastSaveBackup = saveBackupTime;
		this.publish();
		const settings = this.options.settings();
		if (!settings.saveEnabled) return;
		try {
			await pruneProjectBackups(target, 'save', settings.saveRetentionDays, this.options.now());
		} catch (error) {
			// 削除失敗は、既に確定した本体保存の失敗として報告しない。
			if (generation === this.generation) this.reportError(error);
		}
	}
}
