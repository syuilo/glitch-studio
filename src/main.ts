// UI RENDERER PROCESS

import Vue from 'vue';
import Vuex from 'vuex';
const VuexUndoRedo = require('vuex-undo-redo');
import { Titlebar, Color } from 'custom-electron-titlebar';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { ipcRenderer, remote } from 'electron';
const unhandled = require('electron-unhandled');
import App from './App.vue';
import InputDialog from './components/input-dialog.vue';
import { store } from './store';

unhandled();

Vue.config.productionTip = false;

Vue.use(Vuex);
Vue.use(VuexUndoRedo);

Vue.component('fa', FontAwesomeIcon);

const titleBar = new Titlebar({
	icon: 'icon.png',
	backgroundColor: Color.fromHex('#222')
});

new Vue({
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
			const vm = this.new(InputDialog, opts);

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
}).$mount('#app');

ipcRenderer.on('updateMenu', () => {
	titleBar.updateMenu(remote.Menu.getApplicationMenu()!);
});
