type FIXME = any;

declare const _VERSION_: string;

declare const __ELECTRON__: boolean;

interface Window {
	desktop?: {
		showTestAlert(): Promise<void>;
	};
}
