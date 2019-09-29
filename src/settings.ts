import * as fs from 'fs';
import * as path from 'path';
import * as electron from 'electron';
import { encode, decode } from "@msgpack/msgpack";
import { Layer } from './glitch';
import { Macro, Asset } from './glitch/core';
import { version } from './version';
import { encodeAssets } from './encode-assets';

export const userDataPath = (electron.app || electron.remote.app).getPath('userData');
const filePath = path.join(userDataPath, 'settings');

export type Preset = {
	id: string;
	gsVersion: string;
	author: string;
	name: string;
	layers: Layer[];
	macros: Macro[];
	assets: Asset[];
};

export type Settings = {
	version: string;
	presets: Preset[];
	showHistogram: boolean;
};

const defaultSettings: Settings = {
	version: version,
	presets: [],
	showHistogram: false,
};

export class SettingsStore {
	public settings: Settings;

	constructor() {
		try {
			const data = fs.readFileSync(filePath);
			this.settings = decode(data) as Settings;
			console.debug('Settings loaded', filePath);
		} catch (e) {
			this.settings = defaultSettings;
			console.debug('Settings is not created yet', filePath);
		}
	}

	public save() {
		this.settings.version = version;
		const data: any = this.settings;
		data.presets = this.settings.presets.map(preset => ({
			id: preset.id,
			gsVersion: preset.gsVersion,
			author: preset.author,
			name: preset.name,
			layers: preset.layers,
			macros: preset.macros,
			assets: encodeAssets(preset.assets || []),
		}));
		fs.writeFileSync(filePath, encode(data));
		console.debug('Settings saved', filePath);
	}
}

export const settingsStore = new SettingsStore();
