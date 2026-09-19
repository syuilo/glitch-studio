import { encode, decode } from '@msgpack/msgpack';
import { encodeAssets } from './api.ts';
import type { GsNode, Macro, GsAutomation, Asset, NodeGraph, Timeline, Player } from '@glitch/shared/types.ts';

//export const userDataPath = electron.remote.app.getPath('userData');
//const filePath = path.join(userDataPath, 'settings');
const filePath = '';

export type RawPreset = {
	id: string;
	gsVersion: string;
	author: string;
	name: string;
	nodes: GsNode[];
	macros: Macro[];
	assets: Omit<Asset, 'data'>[];
};

export type Preset = {
	id: string;
	gsVersion: string;
	author: string;
	name: string;
	nodes: GsNode[];
	macros: Macro[];
	assets: Asset[];
};

/*
export class SettingsStore {
	public settings: Settings;

	constructor() {
		try {
			const data = fs.readFileSync(filePath);
			this.settings = {
				...defaultSettings,
				...(decode(data) as Record<string, any>),
			} as Settings;
			console.debug('Settings loaded', filePath);
		} catch (e) {
			this.settings = defaultSettings;
			console.debug('Settings is not created yet', filePath);
		}
	}

	public save() {
		this.settings.version = _VERSION_;
		const data: any = this.settings;
		data.presets = this.settings.presets.map(preset => ({
			id: preset.id,
			gsVersion: preset.gsVersion,
			author: preset.author,
			name: preset.name,
			nodes: preset.nodes,
			macros: preset.macros,
			assets: encodeAssets(preset.assets || []),
		}));
		fs.writeFileSync(filePath, encode(data));
		console.debug('Settings saved', filePath);
	}
}

export const settingsStore = new SettingsStore();
*/
