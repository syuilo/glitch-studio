import Vue from 'vue';
import Vuex from 'vuex';
import uuid from 'uuid/v4';
import { Layer } from './glitch';
import { fxs } from './glitch/fxs';

export const store = () => new Vuex.Store({
	state: {
		layers: [] as Layer[]
	},
	mutations: {
		addLayer(state, payload) {
			const paramDef = fxs[payload.fx].paramDef;
			
			const params = {} as any;

			for (const [k, v] of Object.entries(paramDef)) {
				params[k] = v.default;
			}

			state.layers.push({
				id: uuid(),
				fx: payload.fx,
				params: params
			});
		},

		updateParam(state, payload) {
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer.params, payload.param, payload.value);
		},
	}
});
