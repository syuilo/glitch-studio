import en from '../locales/en.json';

export class I18n<T extends Record<string, any>> {
	public ts: T;

	constructor(locale: T) {
		this.ts = locale;

		//#region BIND
		this.t = this.t.bind(this);
		//#endregion
	}

	public t(key: string, args?: Record<string, string | number>): string {
		try {
			let str = key.split('.').reduce((o, i) => o[i], this.ts) as unknown as string;

			if (args) {
				for (const [k, v] of Object.entries(args)) {
					str = str.replace(`{${k}}`, v.toString());
				}
			}
			return str;
		} catch (err) {
			console.warn(`missing localization '${key}'`);
			return key;
		}
	}
}

export const i18n = new I18n(en);
