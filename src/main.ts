// UI RENDERER PROCESS

import Vue from 'vue';
import Vuex from 'vuex';
import VueI18n from 'vue-i18n';
const VuexUndoRedo = require('vuex-undo-redo');
import { Titlebar, Color } from '@syuilo/custom-electron-titlebar';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { ipcRenderer, remote, webFrame, Menu, shell } from 'electron';
const unhandled = require('electron-unhandled');
import App from './App.vue';
import InputDialog from './components/input-dialog.vue';
import { store } from './store';
import { settingsStore, userDataPath } from './settings';
import { locales } from './locales';

unhandled();

Vue.config.productionTip = false;

Vue.use(Vuex);
Vue.use(VuexUndoRedo);
Vue.use(VueI18n);

Vue.component('fa', FontAwesomeIcon);

const i18n = new VueI18n({
	locale: 'ja',
	messages: locales,
});

const titleBar = new Titlebar({
	icon: 'icon.png',
	backgroundColor: Color.fromHex('#222')
});

const v = new Vue({
	i18n,

	data() {
		return {
			titleBar,
		};
	},

	render: h => h(App),

	store: store(),

	methods: {
		new(vm: { new(...args: any[]): Vue }, props: Record<string, any>) {
			const x = new vm({
				parent: this,
				propsData: props
			}).$mount();
			document.body.appendChild(x.$el);
			return x;
		},

		input(opts: { default?: string; }) {
			const vm = (this as any).new(InputDialog, opts);

			const p = new Promise((res) => {
				vm.$once('ok', (result: string) => res({ canceled: false, result }));
				vm.$once('cancel', () => res({ canceled: true }));
			});

			p.then(() => {
				vm.$destroy();
				if (vm.$el.parentNode) vm.$el.parentNode.removeChild(vm.$el);
			});

			return p;
		}
	}
});

let showAllParams = true;

function renderMenu() {
	const menu = remote.Menu.buildFromTemplate([{
		label: v.$t('Menu.File') as string,
		submenu: [{
			label: v.$t('Menu._File.OpenImage') as string,
			accelerator: 'Ctrl+O',
			click: () => {
				v.$emit('openImage');
			}
		}, {
			label: v.$t('Menu._File.SaveImage') as string,
			accelerator: 'Ctrl+S',
			click: () => {
				v.$emit('saveImage');
			}
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._File.SavePreset') as string,
			click: () => {
				v.$emit('savePreset');
			}
		}, {
			label: v.$t('Menu._File.ExportPreset') as string,
			click: () => {
				v.$emit('exportPreset');
			}
		}, {
			label: v.$t('Menu._File.ImportPreset') as string,
			click: () => {
				v.$emit('importPreset');
			}
		}, {
			label: v.$t('Menu._File.RemovePreset') as string,
			submenu: settingsStore.settings.presets.length === 0 ? [{
				label: v.$t('NoPresets') as string,
				enabled: false
			}] : settingsStore.settings.presets.map(p => ({
				label: p.name,
				click: () => {
					v.$emit('removePreset', p.id);
				},
			}))
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._File.Preferences') as string,
			submenu: [{
				label: v.$t('Language') as string,
				submenu: [{
					label: 'English',
					click: () => {
						v.$emit('changeLang', 'en');
					},
				}, {
					label: '日本語',
					click: () => {
						v.$emit('changeLang', 'ja');
					},
				}]
			}]
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._File.Exit') as string,
			role: 'quit'
		}]
	}, {
		label: v.$t('Menu.Edit') as string,
		submenu: [{
			label: v.$t('Menu._Edit.Undo') as string,
			accelerator: 'Ctrl+Z',
			click: () => {
				v.$emit('undo');
			}
		}, {
			label: v.$t('Menu._Edit.Redo') as string,
			accelerator: 'Ctrl+Y',
			click: () => {
				v.$emit('redo');
			}
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._Edit.RandomizeAll') as string,
			enabled: false,
		}, {
			label: v.$t('Menu._Edit.RandomFx') as string,
			enabled: false,
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._Edit.Init') as string,
			accelerator: 'Ctrl+N',
			click: () => {
				v.$emit('init');
			}
		}]
	}, {
		label: v.$t('Menu.View') as string,
		submenu: [{
			label: v.$t('Menu._View.ShowAllParams') as string,
			type: 'checkbox',
			checked: showAllParams,
			click: () => {
				showAllParams = !showAllParams;
				v.$emit('changeShowAllParams', showAllParams);
				renderMenu();
			}
		}, {
			label: v.$t('Menu._View.ShowHistogram') as string,
			type: 'checkbox',
			checked: settingsStore.settings.showHistogram,
			click: () => {
				settingsStore.settings.showHistogram = !settingsStore.settings.showHistogram;
				settingsStore.save();
				v.$emit('changeShowHistogram', settingsStore.settings.showHistogram);
				renderMenu();
			}
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._View.CollapseAllFx') as string,
			click: () => {
				v.$emit('collapseAllFx');
			}
		}, {
			label: v.$t('Menu._View.ExpandAllFx') as string,
			click: () => {
				v.$emit('expandAllFx');
			}
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._View.ZoomIn') as string,
			role: 'zoomIn',
			click: () => {
				v.$emit('zoomIn');
			}
		}, {
			label: v.$t('Menu._View.ZoomOut') as string,
			role: 'zoomOut',
			click: () => {
				v.$emit('zoomOut');
			}
		}, {
			label: v.$t('Menu._View.ResetZoom') as string,
			role: 'resetZoom',
			click: () => {
				v.$emit('resetZoom');
			}
		}, {
			type: 'separator'
		}, {
			label: v.$t('Menu._View.ToggleFullscreen') as string,
			role: 'togglefullscreen',
		}]
	}, {
		label: v.$t('Menu.Presets') as string,
		submenu: settingsStore.settings.presets.length === 0 ? [{
			label: v.$t('NoPresets') as string,
			enabled: false
		}] : settingsStore.settings.presets.map(p => ({
			label: p.name,
			click: () => {
				v.$emit('applyPreset', p.id);
			},
		}))
	}, {
		label: v.$t('Menu.Help') as string,
		submenu: [{
			label: v.$t('Menu._Help.OpenDataFolder') as string,
			click: () => {
				shell.openItem(userDataPath);
			}
		}, {
			label: v.$t('Menu._Help.ToggleDeveloperTools') as string,
			role: 'toggleDevTools',
		}, {
			type: 'separator',
		}, {
			label: v.$t('Menu._Help.ReportIssue') as string,
			click: () => {
				shell.openExternal('https://github.com/syuilo/glitch-studio/issues/new?assignees=&labels=⚠️bug%3F&template=01_bug-report.md&title=');
			}
		}, {
			label: v.$t('Menu._Help.FeatureRequest') as string,
			click: () => {
				shell.openExternal('https://github.com/syuilo/glitch-studio/issues/new?assignees=&labels=✨enhancement%3F&template=02_feature-request.md&title=');
			}
		}, {
			type: 'separator',
		}, {
			label: v.$t('Menu._Help.SupportUsOnPatreon') as string,
			click: () => {
				shell.openExternal('https://www.patreon.com/syuilo');
			}
		}, {
			type: 'separator',
		}, {
			label: v.$t('Menu._Help.About') as string,
			role: 'about',
			click: () => {
				v.$emit('about');
			}
		}]
	}]);

	remote.Menu.setApplicationMenu(menu);
	titleBar.updateMenu(menu);
}

v.$mount('#app');

renderMenu();

let zoom = 1;

v.$on('zoomIn', () => {
	zoom += 0.1;
	webFrame.setZoomFactor(zoom);
});

v.$on('zoomOut', () => {
	zoom -= 0.1;
	webFrame.setZoomFactor(zoom);
});

v.$on('resetZoom', () => {
	zoom = 1;
	webFrame.setZoomFactor(zoom);
});

v.$on('updateMenu', () => {
	renderMenu();
});

v.$on('changeLang', (locale: string) => {
	i18n.locale = locale;
	renderMenu();
});


