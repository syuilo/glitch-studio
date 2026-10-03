import * as ui from '@/ui.js';

/**
 * Clipboardに値をコピー(TODO: 文字列以外も対応)
 */
export function copyToClipboard(input: string | null) {
	if (input) {
		navigator.clipboard.writeText(input);
		//ui.toast(i18n.ts.copiedToClipboard);
	}
};
