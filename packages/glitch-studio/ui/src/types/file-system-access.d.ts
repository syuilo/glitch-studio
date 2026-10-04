// @types/webに含まれない、Chromeのローカルファイル選択・権限API。
interface ProjectFilePickerOptions {
	id?: string;
	types?: { description: string; accept: Record<string, string[]> }[];
	excludeAcceptAllOption?: boolean;
}

interface Window {
	showOpenFilePicker(options?: ProjectFilePickerOptions & { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
	showDirectoryPicker(options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle }): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
	requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface DataTransferItem {
	getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
