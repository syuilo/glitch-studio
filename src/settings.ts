import * as fs from 'fs';
import * as path from 'path';
import * as electron from 'electron';
import { encode, decode } from "@msgpack/msgpack";
import { Layer } from './glitch';
import { Macro } from './glitch/core';

const userDataPath = (electron.app || electron.remote.app).getPath('userData');
const filePath = path.join(userDataPath, 'settings');

export type Preset = {
	id: string;
	author: string;
	name: string;
	layers: Layer[];
	macros: Macro[];
};

export type Settings = {
	presets: Preset[];
};

const defaultSettings: Settings = {
	presets: []
};

export class SettingsStore {
	public settings: Settings;

	constructor() {
		try {
			const data = fs.readFileSync(filePath);
			this.settings = decode(data) as Settings;
		} catch (e) {
			this.settings = defaultSettings;
		}
	}

	public save() {
		fs.writeFileSync(filePath, encode(this.settings));
		console.debug('Settings saved', filePath);
	}
}

export const settingsStore = new SettingsStore();
