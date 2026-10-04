type FIXME = any;

declare const _VERSION_: string;

declare const __ELECTRON__: boolean;

interface Window {
	desktop?: {
		getPathForFile(file: File): string;
		registerProjectFile(file: File): Promise<{ id: string; name: string } | null>;
		chooseProjectFile(): Promise<{ id: string; name: string } | null>;
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
	};
}
