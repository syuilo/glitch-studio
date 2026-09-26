// @types/webに含まれない、Chromeのローカルファイル選択・権限API。
interface ProjectFilePickerOptions {
	id?: string;
	types?: { description: string; accept: Record<string, string[]> }[];
	excludeAcceptAllOption?: boolean;
}

interface Window {
	showOpenFilePicker(options?: ProjectFilePickerOptions & { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
	showSaveFilePicker(options?: ProjectFilePickerOptions & { suggestedName?: string; startIn?: FileSystemHandle }): Promise<FileSystemFileHandle>;
}

interface FileSystemHandle {
	requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface DataTransferItem {
	getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
