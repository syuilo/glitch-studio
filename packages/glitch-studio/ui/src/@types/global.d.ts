type FIXME = any;

declare const _VERSION_: string;

declare const __ELECTRON__: boolean;

interface Window {
	desktop?: {
		onProjectCloseRequested(listener: (requestId: number) => void): () => void;
		completeProjectClose(requestId: number, confirmed: boolean): Promise<boolean>;
		getUpdateState(): Promise<import('@gs/glitch-studio_shared/desktop-update.ts').DesktopUpdateState>;
		checkForUpdates(): Promise<import('@gs/glitch-studio_shared/desktop-update.ts').DesktopUpdateState>;
		prepareUpdate(version: string): Promise<import('@gs/glitch-studio_shared/desktop-update.ts').DesktopUpdateState>;
		startUpdate(): Promise<import('@gs/glitch-studio_shared/desktop-update.ts').DesktopUpdateState>;
		abortUpdatePreparation(): Promise<import('@gs/glitch-studio_shared/desktop-update.ts').DesktopUpdateState>;
		onUpdateStateChanged(listener: (state: import('@gs/glitch-studio_shared/desktop-update.ts').DesktopUpdateState) => void): () => void;
		voicevoxConnect(endpoint: string): Promise<{ version: string; speakers: import('@gs/glitch-studio_shared/voicevox.ts').VoicevoxSpeaker[] }>;
		voicevoxSynthesize(request: import('@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts').VoicevoxRequest): Promise<{ data: Uint8Array; engineVersion: string; audioQuery: Record<string, unknown> }>;
		takeStartupProjectFile(): Promise<{ id: string; name: string } | null>;
		getPathForFile(file: File): string;
		resolveExternalAsset(filePath: string, reload?: boolean): Promise<import('@gs/shared/file-source.ts').UrlFileSource>;
		assetProjectPaths(paths: (string | null)[], projectId: string | null, storing: boolean): Promise<(string | null)[]>;
		chooseAssetFile(previousPath: string | null): Promise<string | null>;
		beginAssetExport(name: string): Promise<string | null>;
		writeAssetExport(id: string, chunk: Uint8Array | null): Promise<void>;
		abortAssetExport(id: string): Promise<void>;
		registerProjectFile(file: File): Promise<{ id: string; name: string } | null>;
		chooseProjectFile(): Promise<{ id: string; name: string } | null>;
		listRecentProjects(): Promise<import('../recent-projects.ts').RecentProjectEntry[]>;
		rememberRecentProject(id: string, name: string): Promise<void>;
		resolveRecentProject(id: string): Promise<{ id: string; name: string }>;
		removeRecentProject(id: string): Promise<void>;
		clearRecentProjects(): Promise<void>;
		chooseProjectSaveFile(name: string): Promise<{ id: string; name: string } | null>;
		readProjectFile(id: string): Promise<Uint8Array | null>;
		writeProjectFile(id: string, data: Uint8Array): Promise<void>;
		listProjectBackups(id: string): Promise<string[]>;
		writeProjectBackup(id: string, name: string, data: Uint8Array): Promise<boolean>;
		copyProjectBackup(id: string, name: string): Promise<'created' | 'exists' | 'empty'>;
		removeProjectBackup(id: string, name: string): Promise<void>;
		showTestAlert(): Promise<void>;
		openDevTools(): Promise<void>;
		toggleDevTools(): Promise<void>;
		zoomIn(): Promise<void>;
		zoomOut(): Promise<void>;
		executeEditCommand(command: import('@gs/glitch-studio_shared/desktop-edit.ts').DesktopEditCommand): Promise<void>;
		/** nullで非表示、0〜1で進捗率、1より大きい値で処理中表示。 */
		setProgressBar(progress: number | null): Promise<void>;
		notifyExportComplete(fileName: string): Promise<void>;
		chooseExportSaveFile(name: string, format: 'mp4' | 'webp'): Promise<{ id: string; name: string } | null>;
		writeExportFile(id: string, data: Uint8Array): Promise<void>;
		releaseExportFile(id: string): Promise<void>;
	};
}
