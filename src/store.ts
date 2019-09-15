import Vue from 'vue';
import Vuex from 'vuex';
import uuid from 'uuid/v4';
import { Layer } from './glitch';

export const store = () => new Vuex.Store({
	state: {
		layers: [] as Layer[]
	},
	mutations: {
		addLayer(state, payload) {
			state.layers.push({
				id: uuid(),
				fx: payload.fx,
				params: {}
			});
		},

		updateParam(state, payload) {
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer.params, payload.param, payload.value);
		},
	}
});
