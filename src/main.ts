import Vue from 'vue';
import Vuex from 'vuex';
const VuexUndoRedo = require('vuex-undo-redo');
import { Titlebar, Color } from 'custom-electron-titlebar';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import App from './App.vue';
import { store } from './store';

Vue.config.productionTip = false;

Vue.use(Vuex);
Vue.use(VuexUndoRedo);

Vue.component('fa', FontAwesomeIcon);

new Vue({
	render: h => h(App),
	store: store(),
}).$mount('#app');

new Titlebar({
	icon: 'icon.png',
	backgroundColor: Color.fromHex('#222')
});
