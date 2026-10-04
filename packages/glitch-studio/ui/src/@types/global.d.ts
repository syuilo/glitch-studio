type FIXME = any;

declare const _VERSION_: string;

declare const __ELECTRON__: boolean;

interface Window {
	desktop?: {
		getPathForFile(file: File): string;
		showTestAlert(): Promise<void>;
		openDevTools(): Promise<void>;
		toggleDevTools(): Promise<void>;
		zoomIn(): Promise<void>;
		zoomOut(): Promise<void>;
	};
}
