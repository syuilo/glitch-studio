import { lang } from '@/i18n.ts';

let _dateTimeFormat: Intl.DateTimeFormat;
try {
	_dateTimeFormat = new Intl.DateTimeFormat(lang, {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	});
} catch (err) {
	console.warn(err);
	if (import.meta.env.DEV) console.log('[Intl] Fallback to en-US');

	// Fallback to en-US
	_dateTimeFormat = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	});
}
export const dateTimeFormat = _dateTimeFormat;

export const timeZone = dateTimeFormat.resolvedOptions().timeZone;

export const hemisphere = /^(australia|pacific|antarctica|indian)\//i.test(timeZone) ? 'S' : 'N';

let _numberFormat: Intl.NumberFormat;
try {
	_numberFormat = new Intl.NumberFormat(lang);
} catch (err) {
	console.warn(err);
	if (import.meta.env.DEV) console.log('[Intl] Fallback to en-US');

	// Fallback to en-US
	_numberFormat = new Intl.NumberFormat('en-US');
}
export const numberFormat = _numberFormat;
