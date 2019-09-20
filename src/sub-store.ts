import Vue from 'vue';
import { settingsStore, SettingsStore } from './settings';

export type State = {
	showAllParams: boolean;
	rendering: boolean;
	processingFxId: string | null;
	imageWidth: number;
	imageHeight: number;
	settingsStore: SettingsStore;
}

export const subStore = Vue.observable<State>({
	showAllParams: true,
	rendering: false,
	processingFxId: null,
	imageWidth: 0,
	imageHeight: 0,
	settingsStore: settingsStore,
});
