import Vue from 'vue';
import Vuex from 'vuex';
import { Titlebar, Color } from 'custom-electron-titlebar';
import App from './App.vue';
import { store } from './store';

Vue.config.productionTip = false;

Vue.use(Vuex);

new Vue({
	render: h => h(App),
	store: store(),
}).$mount('#app');

new Titlebar({
	icon: 'icon.png',
	backgroundColor: Color.fromHex('#222')
});
