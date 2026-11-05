export type ClipboardTextAccess = {
	readText(): Promise<string>;
	writeText(text: string): Promise<void>;
};

/** Web/Electronとも同じテキスト形式を使い、ウィンドウ間で共有する。 */
export const clipboardText: ClipboardTextAccess = {
	readText: () => window.desktop != null ? window.desktop.readClipboardText() : navigator.clipboard.readText(),
	writeText: text => window.desktop != null ? window.desktop.writeClipboardText(text) : navigator.clipboard.writeText(text),
};
