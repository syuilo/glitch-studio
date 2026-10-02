// DOM型定義に未収録の環境でも、このAPIを使う箇所だけで型を補う。
export type LocalFont = {
	family: string;
	fullName: string;
	postscriptName: string;
	style: string;
	blob: () => Promise<Blob>;
};

type LocalFontWindow = Window & {
	queryLocalFonts?: () => Promise<LocalFont[]>;
};

export function supportsLocalFonts(): boolean {
	return window.isSecureContext && typeof (window as LocalFontWindow).queryLocalFonts === 'function';
}

export async function queryLocalFonts(): Promise<LocalFont[]> {
	const fontWindow = window as LocalFontWindow;
	if (!supportsLocalFonts() || !fontWindow.queryLocalFonts) {
		throw new Error('Local fonts are unavailable. Import a font file using Add asset.');
	}
	// 許可要求にユーザー操作が必要なため、ボタンのクリックから直接呼び出す。
	const fonts = await fontWindow.queryLocalFonts();
	return fonts.sort((a, b) => a.family.localeCompare(b.family)
		|| a.fullName.localeCompare(b.fullName)
		|| a.postscriptName.localeCompare(b.postscriptName));
}

export function localFontErrorMessage(error: unknown): string {
	if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
		return 'Local font access was not allowed. Allow font access in the browser site settings, or import a font file using Add asset.';
	}
	return error instanceof Error ? error.message : String(error);
}
