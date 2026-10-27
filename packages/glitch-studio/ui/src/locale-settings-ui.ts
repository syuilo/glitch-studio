import { saveLocale, SUPPORTED_LOCALES } from './i18n.ts';
import * as ui from './ui.ts';

export async function configureLocale() {
	const { canceled, result } = await ui.select({
		title: 'Select Language / 言語を選択',
		items: Object.entries(SUPPORTED_LOCALES).map(([value, label]) => ({ label, value })),
		default: Object.hasOwn(SUPPORTED_LOCALES, navigator.language) ? navigator.language : 'en-US',
	});

	if (!canceled && Object.hasOwn(SUPPORTED_LOCALES, result)) {
		await changeLocale(result);
	}
}

export async function changeLocale(locale: string) {
	const newLocale = await saveLocale(locale);
	if (newLocale == null) return;

	// 現在の表示言語にかかわらず、適用タイミングの案内は選択した言語で表示する。
	ui.alert({
		title: newLocale.LocaleChangedTitle,
		text: newLocale.LocaleChangedDescription,
	});
}
