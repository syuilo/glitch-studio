import * as fs from 'fs';
import * as path from 'path';
import * as electron from 'electron';
import { encode, decode } from "@msgpack/msgpack";
import { Layer } from './glitch';
import { Macro } from './glitch/core';
import { version } from './version';

export const userDataPath = (electron.app || electron.remote.app).getPath('userData');
const filePath = path.join(userDataPath, 'settings');

export type Preset = {
	id: string;
	gsVersion: string;
	author: string;
	name: string;
	layers: Layer[];
	macros: Macro[];
};

export type Settings = {
	version: string;
	presets: Preset[];
};

const defaultSettings: Settings = {
	version: version,
	presets: []
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
		fs.writeFileSync(filePath, encode(this.settings));
		console.debug('Settings saved', filePath);
	}
}

export const settingsStore = new SettingsStore();
