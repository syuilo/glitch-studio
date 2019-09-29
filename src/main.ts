// UI RENDERER PROCESS

import Vue from 'vue';
import Vuex from 'vuex';
const VuexUndoRedo = require('vuex-undo-redo');
import { Titlebar, Color } from '@syuilo/custom-electron-titlebar';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { ipcRenderer, remote, webFrame, Menu, shell } from 'electron';
const unhandled = require('electron-unhandled');
import App from './App.vue';
import InputDialog from './components/input-dialog.vue';
import { store } from './store';
import { settingsStore, userDataPath } from './settings';

unhandled();

Vue.config.productionTip = false;

Vue.use(Vuex);
Vue.use(VuexUndoRedo);

Vue.component('fa', FontAwesomeIcon);

const titleBar = new Titlebar({
	icon: 'icon.png',
	backgroundColor: Color.fromHex('#222')
});

const v = new Vue({
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
		label: 'File',
		submenu: [{
			label: 'Open Image',
			accelerator: 'Ctrl+O',
			click: () => {
				v.$emit('openImage');
			}
		}, {
			label: 'Save Image',
			accelerator: 'Ctrl+S',
			click: () => {
				v.$emit('saveImage');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Save Preset',
			click: () => {
				v.$emit('savePreset');
			}
		}, {
			label: 'Export Preset',
			click: () => {
				v.$emit('exportPreset');
			}
		}, {
			label: 'Import Preset',
			click: () => {
				v.$emit('importPreset');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Remove Preset',
			submenu: settingsStore.settings.presets.length === 0 ? [{
				label: 'No presets',
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
			role: 'quit'
		}]
	}, {
		label: 'Edit',
		submenu: [{
			label: 'Undo',
			accelerator: 'Ctrl+Z',
			click: () => {
				v.$emit('undo');
			}
		}, {
			label: 'Redo',
			accelerator: 'Ctrl+Y',
			click: () => {
				v.$emit('redo');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Randomize All',
			enabled: false,
		}, {
			label: 'Randomize World',
			enabled: false,
		}, {
			type: 'separator'
		}, {
			label: 'Init',
			accelerator: 'Ctrl+N',
			click: () => {
				v.$emit('init');
			}
		}]
	}, {
		label: 'View',
		submenu: [{
			label: 'Show All Params',
			type: 'checkbox',
			checked: showAllParams,
			click: () => {
				showAllParams = !showAllParams;
				v.$emit('changeShowAllParams', showAllParams);
				renderMenu();
			}
		}, {
			label: 'Show Histogram',
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
			label: 'Collapse All FX',
			click: () => {
				v.$emit('collapseAllFx');
			}
		}, {
			label: 'Expand All FX',
			click: () => {
				v.$emit('expandAllFx');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Zoom In',
			role: 'zoomIn',
			click: () => {
				v.$emit('zoomIn');
			}
		}, {
			label: 'Zoom Out',
			role: 'zoomOut',
			click: () => {
				v.$emit('zoomOut');
			}
		}, {
			label: 'Reset Zoom',
			role: 'resetZoom',
			click: () => {
				v.$emit('resetZoom');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Toggle Fullscreen',
			role: 'togglefullscreen',
		}]
	}, {
		label: 'Presets',
		submenu: settingsStore.settings.presets.length === 0 ? [{
			label: 'No presets',
			enabled: false
		}] : settingsStore.settings.presets.map(p => ({
			label: p.name,
			click: () => {
				v.$emit('applyPreset', p.id);
			},
		}))
	}, {
		label: 'Help',
		submenu: [{
			label: 'Open Data Folder',
			click: () => {
				shell.openItem(userDataPath);
			}
		}, {
			label: 'Toggle Developer Tools',
			role: 'toggleDevTools',
		}, {
			type: 'separator',
		}, {
			label: 'Report Issue',
			click: () => {
				shell.openExternal('https://github.com/syuilo/glitch-studio/issues/new?assignees=&labels=⚠️bug%3F&template=01_bug-report.md&title=');
			}
		}, {
			label: 'Feature Request',
			click: () => {
				shell.openExternal('https://github.com/syuilo/glitch-studio/issues/new?assignees=&labels=✨enhancement%3F&template=02_feature-request.md&title=');
			}
		}, {
			type: 'separator',
		}, {
			label: 'Support Us on Patreon',
			click: () => {
				shell.openExternal('https://www.patreon.com/syuilo');
			}
		}, {
			type: 'separator',
		}, {
			label: 'About',
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

